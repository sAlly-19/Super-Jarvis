import asyncio
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

# Add parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from provider_adapters import ProviderAdapterError, ProviderResponse, ProviderToolCall
from runtime import JasperRuntime, _transcribe_wav_sync, normalize_model_name, validate_provider_model


class FakeProviderAdapter:
    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.validated_models = []
        self.completions = []
        self.closed = False

    async def validate_model(self, model):
        self.validated_models.append(model)
        if self.error:
            raise self.error

    async def complete(self, model, messages, tools, temperature):
        self.completions.append(
            {"model": model, "messages": messages, "tools": tools, "temperature": temperature}
        )
        if self.error:
            raise self.error
        return self.responses.pop(0)

    async def aclose(self):
        self.closed = True


class TestJasperRuntime(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = JasperRuntime()

    async def test_hello_produces_hello_ack(self):
        msg = {
            "version": 1,
            "id": "req-1",
            "type": "hello",
            "payload": {"client": "test", "protocolVersion": 1},
        }
        replies = [reply async for reply in self.runtime.handle(msg)]
        self.assertEqual(len(replies), 1)
        ack = replies[0]
        self.assertEqual(ack["version"], 1)
        self.assertEqual(ack["type"], "hello_ack")
        self.assertEqual(ack["replyTo"], "req-1")
        self.assertEqual(ack["payload"]["protocolVersion"], 1)
        self.assertIn("tools", ack["payload"])
        self.assertIsInstance(ack["payload"]["tools"], list)

    def test_validate_provider_model_enforces_allowlist(self):
        self.assertEqual(
            validate_provider_model("gemini", "gemini/gemini-3.8-flash"),
            ("gemini", "gemini/gemini-3.8-flash"),
        )
        self.assertEqual(
            validate_provider_model("groq", "groq/openai/gpt-oss-120b"),
            ("groq", "groq/openai/gpt-oss-120b"),
        )
        self.assertEqual(
            validate_provider_model("ollama", "ollama/qwen2.5:3b"),
            ("ollama", "ollama/qwen2.5:3b"),
        )
        with self.assertRaises(ValueError):
            validate_provider_model("gemini", "groq/openai/gpt-oss-120b")
        with self.assertRaises(ValueError):
            validate_provider_model("gemini", "gemini/gemini-2.5-flash")
        with self.assertRaises(ValueError):
            validate_provider_model("groq", "groq/llama-3.3-70b-versatile")
        with self.assertRaises(ValueError):
            validate_provider_model("ollama", "gemini/gemini-3.8-flash")
        with self.assertRaises(ValueError):
            validate_provider_model("openai", "openai/gpt-4o")

    def test_normalize_model_name_migrates_retired_groq_model(self):
        self.assertEqual(
            normalize_model_name("groq/llama-3.3-70b-versatile"),
            "groq/openai/gpt-oss-120b",
        )
        self.assertEqual(
            normalize_model_name("gemini/gemini-2.5-flash"),
            "gemini/gemini-3.8-flash",
        )
        self.assertEqual(
            normalize_model_name("gemini-2.5-flash"),
            "gemini/gemini-3.8-flash",
        )

    async def test_config_updates_and_emits_status_for_each_provider(self):
        cases = [
            ("gemini", "gemini/gemini-3.8-flash", "AIzaSyGeminiSecret123"),
            ("groq", "groq/openai/gpt-oss-120b", "gsk_GroqSecret123"),
            ("ollama", "ollama/qwen2.5:3b", ""),
        ]
        for provider, model, api_key in cases:
            adapter = FakeProviderAdapter()
            msg = {
                "version": 1,
                "id": f"req-cfg-{provider}",
                "type": "config",
                "payload": {
                    "provider": provider,
                    "agent_name": "TestBot",
                    "model": model,
                    "voice": "pt-BR-AntonioNeural",
                    "apiKey": api_key,
                },
            }
            with patch("runtime.create_provider_adapter", return_value=adapter):
                replies = [reply async for reply in self.runtime.handle(msg)]
            self.assertEqual(len(replies), 1)
            status = replies[0]
            self.assertEqual(status["type"], "status")
            self.assertEqual(status["replyTo"], f"req-cfg-{provider}")
            self.assertEqual(status["payload"]["status"], "connected")
            self.assertEqual(status["payload"]["provider"], provider)
            self.assertEqual(self.runtime.config["provider"], provider)
            self.assertEqual(self.runtime.config["model"], model)
            self.assertEqual(self.runtime.config["api_key"], api_key)
            self.assertEqual(adapter.validated_models, [model])
            self.assertIs(self.runtime.provider_adapter, adapter)

    async def test_config_validation_failure_does_not_publish_connected_or_replace_previous_config(self):
        previous = dict(self.runtime.config)
        adapter = FakeProviderAdapter(
            error=ProviderAdapterError(
                "authentication",
                "A credencial do provedor Groq foi recusada. Verifique a chave configurada.",
            )
        )
        msg = {
            "version": 1,
            "id": "req-invalid-credential",
            "type": "config",
            "payload": {
                "provider": "groq",
                "agent_name": "Jasper",
                "model": "groq/openai/gpt-oss-120b",
                "voice": "pt-BR-AntonioNeural",
                "apiKey": "gsk_invalid_secret_value",
            },
        }

        with patch("runtime.create_provider_adapter", return_value=adapter):
            replies = [reply async for reply in self.runtime.handle(msg)]

        self.assertEqual([reply["type"] for reply in replies], ["error"])
        self.assertIn("credencial", replies[0]["payload"]["message"].lower())
        self.assertEqual(self.runtime.config, previous)
        self.assertTrue(adapter.closed)

    async def test_config_rejects_mismatched_model_or_missing_remote_key_without_leaking_secret(self):
        bad_secret = "AIzaSyNeverLeakThisKey999"
        mismatch_msg = {
            "version": 1,
            "id": "req-bad-mismatch",
            "type": "config",
            "payload": {
                "provider": "gemini",
                "agent_name": "Jasper",
                "model": "groq/openai/gpt-oss-120b",
                "voice": "pt-BR-AntonioNeural",
                "apiKey": bad_secret,
            },
        }
        replies = [reply async for reply in self.runtime.handle(mismatch_msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "error")
        self.assertNotIn(bad_secret, json.dumps(replies))

        for provider, model, expected_label in (
            ("gemini", "gemini/gemini-3.8-flash", "Gemini"),
            ("groq", "groq/openai/gpt-oss-120b", "Groq"),
        ):
            missing_key_msg = {
                "version": 1,
                "id": f"req-missing-{provider}",
                "type": "config",
                "payload": {
                    "provider": provider,
                    "agent_name": "Jasper",
                    "model": model,
                    "voice": "pt-BR-AntonioNeural",
                    "apiKey": "",
                },
            }
            replies = [reply async for reply in self.runtime.handle(missing_key_msg)]
            self.assertEqual(len(replies), 1)
            self.assertEqual(replies[0]["type"], "error")
            self.assertIn(expected_label, replies[0]["payload"]["message"])

    async def test_ollama_turn_uses_local_endpoint_and_reports_unavailable_local_service(self):
        self.runtime.update_config(
            {
                "provider": "ollama",
                "agent_name": "Jasper",
                "model": "ollama/qwen2.5:3b",
                "voice": "pt-BR-AntonioNeural",
                "apiKey": "",
            }
        )
        adapter = FakeProviderAdapter(
            error=ProviderAdapterError(
                "network",
                "Serviço local Ollama indisponível em http://127.0.0.1:11434.",
            )
        )
        self.runtime.provider_adapter = adapter
        with patch("runtime.generate_tts_base64", new_callable=AsyncMock, return_value=""):
            replies = [
                r
                async for r in self.runtime.handle(
                    {"version": 1, "id": "chat-ollama", "type": "chat", "payload": {"text": "Olá"}}
                )
            ]

        self.assertEqual(len(adapter.completions), 1)
        self.assertEqual(adapter.completions[0]["model"], "ollama/qwen2.5:3b")

        response_msgs = [r for r in replies if r["type"] == "response"]
        self.assertEqual(len(response_msgs), 1)
        text = response_msgs[0]["payload"]["text"]
        self.assertIn("Ollama", text)
        self.assertNotIn("internal-token-xyz", text)

    async def test_remote_provider_error_never_leaks_submitted_api_key(self):
        secret_key = "gsk_SuperSecretGroqCredentialValue12345"
        self.runtime.update_config(
            {
                "provider": "groq",
                "agent_name": "Jasper",
                "model": "groq/openai/gpt-oss-120b",
                "voice": "pt-BR-AntonioNeural",
                "apiKey": secret_key,
            }
        )
        adapter = FakeProviderAdapter(
            error=ProviderAdapterError(
                "authentication",
                "A credencial do provedor Groq foi recusada. Verifique a chave configurada.",
            )
        )
        self.runtime.provider_adapter = adapter
        with patch("runtime.generate_tts_base64", new_callable=AsyncMock, return_value=""):
            replies = [
                r
                async for r in self.runtime.handle(
                    {"version": 1, "id": "chat-groq", "type": "chat", "payload": {"text": "Teste"}}
                )
            ]

        serialized = json.dumps(replies)
        self.assertNotIn(secret_key, serialized)
        response_msgs = [r for r in replies if r["type"] == "response"]
        self.assertEqual(len(response_msgs), 1)
        self.assertIn("Groq", response_msgs[0]["payload"]["text"])
        self.assertIn("credencial", response_msgs[0]["payload"]["text"].lower())

    async def test_provider_independent_tool_loop_executes_and_returns_final_response(self):
        self.runtime.update_config(
            {
                "provider": "groq",
                "model": "groq/openai/gpt-oss-120b",
                "apiKey": "gsk_test_key_value",
            }
        )
        adapter = FakeProviderAdapter(
            responses=[
                ProviderResponse(
                    content="",
                    tool_calls=[
                        ProviderToolCall(
                            id="call-1",
                            name="test_tool",
                            arguments={"value": 7},
                        )
                    ],
                    assistant_message={
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {"name": "test_tool", "arguments": '{"value": 7}'},
                            }
                        ],
                    },
                ),
                ProviderResponse(
                    content="Ferramenta concluída.",
                    tool_calls=[],
                    assistant_message={"role": "assistant", "content": "Ferramenta concluída."},
                ),
            ]
        )
        self.runtime.provider_adapter = adapter

        with patch.dict("runtime.AVAILABLE_FUNCTIONS", {"test_tool": lambda value: json.dumps({"value": value})}), patch(
            "runtime.generate_tts_base64", new_callable=AsyncMock, return_value=""
        ):
            replies = [
                reply
                async for reply in self.runtime.handle(
                    {"version": 1, "id": "chat-tool", "type": "chat", "payload": {"text": "Execute"}}
                )
            ]

        self.assertEqual(len(adapter.completions), 2)
        self.assertEqual([reply["type"] for reply in replies].count("tool_execution"), 1)
        self.assertEqual([reply["type"] for reply in replies].count("tool_result"), 1)
        response = next(reply for reply in replies if reply["type"] == "response")
        self.assertEqual(response["payload"]["text"], "Ferramenta concluída.")
        tool_message = adapter.completions[1]["messages"][-1]
        self.assertEqual(tool_message["tool_call_id"], "call-1")

    def test_groq_transcription_uses_official_sdk_without_litellm(self):
        calls = []

        class FakeTranscriptions:
            def create(self, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(text="transcrição oficial")

        class FakeGroqClient:
            def __init__(self, api_key):
                self.api_key = api_key
                self.audio = SimpleNamespace(transcriptions=FakeTranscriptions())

            def close(self):
                return None

        fake_module = SimpleNamespace(Groq=FakeGroqClient)
        with patch.dict(sys.modules, {"groq": fake_module, "litellm": None}):
            text = _transcribe_wav_sync(b"RIFF-test", "gsk_test_secret", "groq")

        self.assertEqual(text, "transcrição oficial")
        self.assertEqual(calls[0]["model"], "whisper-large-v3-turbo")
        self.assertEqual(calls[0]["language"], "pt")
        self.assertEqual(calls[0]["file"][0], "speech.wav")

    async def test_memory_clear_and_snapshot(self):
        # Prepopulate fact
        self.runtime.facts.append({"fact": "O usuário gosta de programar"})

        # Snapshot
        snap_msg = {"version": 1, "id": "req-snap", "type": "memory_snapshot", "payload": {}}
        replies = [r async for r in self.runtime.handle(snap_msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "memory_upsert")
        self.assertEqual(len(replies[0]["payload"]["facts"]), 1)

        # Clear
        clr_msg = {"version": 1, "id": "req-clr", "type": "memory_clear", "payload": {}}
        replies = [r async for r in self.runtime.handle(clr_msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "memory_clear")
        self.assertEqual(len(self.runtime.facts), 0)

    async def test_shutdown_emits_status(self):
        adapter = FakeProviderAdapter()
        self.runtime.provider_adapter = adapter
        msg = {"version": 1, "id": "req-shut", "type": "shutdown", "payload": {}}
        replies = [r async for r in self.runtime.handle(msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "status")
        self.assertEqual(replies[0]["payload"]["status"], "shutting_down")
        self.assertEqual(replies[0]["replyTo"], "req-shut")
        self.assertTrue(adapter.closed)
        self.assertIsNone(self.runtime.provider_adapter)


if __name__ == "__main__":
    unittest.main()
