import asyncio
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

# Add parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from runtime import JasperRuntime, validate_provider_model


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
            validate_provider_model("gemini", "gemini/gemini-2.5-flash"),
            ("gemini", "gemini/gemini-2.5-flash"),
        )
        self.assertEqual(
            validate_provider_model("groq", "groq/llama-3.3-70b-versatile"),
            ("groq", "groq/llama-3.3-70b-versatile"),
        )
        self.assertEqual(
            validate_provider_model("ollama", "ollama/qwen2.5:3b"),
            ("ollama", "ollama/qwen2.5:3b"),
        )
        with self.assertRaises(ValueError):
            validate_provider_model("gemini", "groq/llama-3.3-70b-versatile")
        with self.assertRaises(ValueError):
            validate_provider_model("ollama", "gemini/gemini-2.5-flash")
        with self.assertRaises(ValueError):
            validate_provider_model("openai", "openai/gpt-4o")

    async def test_config_updates_and_emits_status_for_each_provider(self):
        cases = [
            ("gemini", "gemini/gemini-2.5-flash", "AIzaSyGeminiSecret123"),
            ("groq", "groq/llama-3.3-70b-versatile", "gsk_GroqSecret123"),
            ("ollama", "ollama/qwen2.5:3b", ""),
        ]
        for provider, model, api_key in cases:
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

    async def test_config_rejects_mismatched_model_or_missing_remote_key_without_leaking_secret(self):
        bad_secret = "AIzaSyNeverLeakThisKey999"
        mismatch_msg = {
            "version": 1,
            "id": "req-bad-mismatch",
            "type": "config",
            "payload": {
                "provider": "gemini",
                "agent_name": "Jasper",
                "model": "groq/llama-3.3-70b-versatile",
                "voice": "pt-BR-AntonioNeural",
                "apiKey": bad_secret,
            },
        }
        replies = [reply async for reply in self.runtime.handle(mismatch_msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "error")
        self.assertNotIn(bad_secret, json.dumps(replies))

        for provider, model, expected_label in (
            ("gemini", "gemini/gemini-2.5-flash", "Gemini"),
            ("groq", "groq/llama-3.3-70b-versatile", "Groq"),
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
        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_acompletion, patch(
            "runtime.generate_tts_base64", new_callable=AsyncMock, return_value=""
        ):
            mock_acompletion.side_effect = ConnectionError(
                "Connection refused: http://127.0.0.1:11434 internal-token-xyz"
            )
            replies = [
                r
                async for r in self.runtime.handle(
                    {"version": 1, "id": "chat-ollama", "type": "chat", "payload": {"text": "Olá"}}
                )
            ]

        self.assertTrue(mock_acompletion.called)
        call_kwargs = mock_acompletion.call_args.kwargs
        self.assertEqual(call_kwargs.get("api_base"), "http://127.0.0.1:11434")
        self.assertNotIn("api_key", call_kwargs)

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
                "model": "groq/llama-3.3-70b-versatile",
                "voice": "pt-BR-AntonioNeural",
                "apiKey": secret_key,
            }
        )
        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_acompletion, patch(
            "runtime.generate_tts_base64", new_callable=AsyncMock, return_value=""
        ):
            mock_acompletion.side_effect = RuntimeError(f"Authentication failed for key {secret_key}")
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
        msg = {"version": 1, "id": "req-shut", "type": "shutdown", "payload": {}}
        replies = [r async for r in self.runtime.handle(msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "status")
        self.assertEqual(replies[0]["payload"]["status"], "shutting_down")
        self.assertEqual(replies[0]["replyTo"], "req-shut")


if __name__ == "__main__":
    unittest.main()
