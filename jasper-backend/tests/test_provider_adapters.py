import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from provider_adapters import (
    GeminiAdapter,
    GroqAdapter,
    OllamaAdapter,
    ProviderAdapterError,
    create_provider_adapter,
)


class AsyncRecorder:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    async def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        if self.error:
            raise self.error
        return self.result


class FakeHttpResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            error = RuntimeError(f"HTTP {self.status_code}")
            error.status_code = self.status_code
            raise error

    def json(self):
        return self.payload


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_system_telemetry",
            "description": "Coleta telemetria local.",
            "parameters": {
                "type": "object",
                "properties": {"detail": {"type": "string"}},
                "required": ["detail"],
            },
        },
    }
]


class ProviderAdaptersTests(unittest.IsolatedAsyncioTestCase):
    async def test_gemini_keeps_signed_parts_in_volatile_round_trip_and_hides_thought_text(self):
        from google.genai import types
        thought = types.Part(text='private-reasoning', thought=True, thought_signature=b'thought-signed')
        first = types.Part(function_call=types.FunctionCall(id='signed-1', name='get_system_telemetry', args={}), thought_signature=b'opaque-signature')
        second = types.Part(function_call=types.FunctionCall(id='signed-2', name='get_system_telemetry', args={}))
        generate = AsyncRecorder(SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[thought, first, second]))]))
        adapter = GeminiAdapter('test', client=SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate))))
        messages = [{'role': 'user', 'content': 'Read twice'}]
        result = await adapter.complete('gemini/gemini-3.8-flash', messages, TOOLS, 0.4)
        self.assertNotIn('private-reasoning', result.content)
        messages.extend([result.assistant_message,
            {'role': 'tool', 'tool_call_id': 'signed-1', 'name': 'get_system_telemetry', 'content': '{}'},
            {'role': 'tool', 'tool_call_id': 'signed-2', 'name': 'get_system_telemetry', 'content': '{}'}])
        await adapter.complete('gemini/gemini-3.8-flash', messages, TOOLS, 0.4)
        sent = generate.calls[1][1]['contents']
        self.assertIs(sent[1]['parts'][0], thought)
        self.assertIs(sent[1]['parts'][1], first)
        self.assertEqual(len(sent[2]['parts']), 2)
        self.assertEqual(len(sent), 3)
        typed = types.Content.model_validate(sent[1])
        self.assertEqual(typed.parts[1].thought_signature, b'opaque-signature')

    async def test_gemini_projects_nested_tool_schemas_without_mutating_canonical_catalog(self):
        import copy
        schema = {'type': 'object', 'additionalProperties': False, 'properties': {
            'additionalProperties': {'type': 'string'},
            'rows': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                'properties': {'level': {'type': 'integer', 'minimum': 0, 'maximum': 100}}, 'required': ['level']}}
        }, 'required': ['rows']}
        tools = [{'type': 'function', 'function': {'name': 'inspect_rows', 'description': 'Inspect', 'parameters': schema}}]
        original = copy.deepcopy(tools)
        generate = AsyncRecorder(SimpleNamespace(candidates=[]))
        adapter = GeminiAdapter('test', client=SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate))))
        await adapter.complete('gemini/gemini-3.8-flash', [{'role': 'user', 'content': 'test'}], tools, 0.4)
        parameters = generate.calls[0][1]['config']['tools'][0]['function_declarations'][0]['parameters']
        self.assertNotIn('additionalProperties', parameters)
        self.assertNotIn('additionalProperties', parameters['properties']['rows']['items'])
        self.assertEqual(parameters['properties']['additionalProperties'], {'type': 'string'})
        self.assertEqual(parameters['properties']['rows']['items']['properties']['level'], {'type': 'integer', 'minimum': 0, 'maximum': 100})
        self.assertEqual(parameters['required'], ['rows'])
        self.assertEqual(tools, original)

    async def test_google_sdk_code_classifies_errors_without_exposing_response(self):
        from google.genai.errors import ClientError

        for code, message, expected in [
            (400, "API key not valid", "authentication"),
            (429, "limit exceeded", "quota"),
            (404, "missing", "model"),
        ]:
            with self.subTest(code=code):
                error = ClientError(code, {"error": {"message": message}})
                client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(
                    generate_content=AsyncRecorder(error=error)
                )))
                adapter = GeminiAdapter("test-secret", client=client)
                with self.assertRaises(ProviderAdapterError) as raised:
                    await adapter.complete("gemini/gemini-3.8-flash", [{"role": "user", "content": "Oi"}], [], 0.4)
                self.assertEqual(raised.exception.category, expected)

    async def test_groq_strips_internal_prefix_and_normalizes_tool_calls(self):
        tool_call = SimpleNamespace(
            id="call-1",
            function=SimpleNamespace(name="get_system_telemetry", arguments='{"detail":"cpu"}'),
        )
        message = SimpleNamespace(content="", tool_calls=[tool_call])
        create = AsyncRecorder(SimpleNamespace(choices=[SimpleNamespace(message=message)]))
        retrieve = AsyncRecorder(SimpleNamespace(id="openai/gpt-oss-120b"))
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
            models=SimpleNamespace(retrieve=retrieve),
        )
        adapter = GroqAdapter("gsk_test_secret", client=client)

        await adapter.validate_model("groq/openai/gpt-oss-120b")
        result = await adapter.complete(
            "groq/openai/gpt-oss-120b",
            [{"role": "system", "content": "Sistema"}, {"role": "user", "content": "CPU?"}],
            TOOLS,
            0.4,
        )

        self.assertEqual(retrieve.calls[0][0], ("openai/gpt-oss-120b",))
        sent = create.calls[0][1]
        self.assertEqual(sent["model"], "openai/gpt-oss-120b")
        self.assertEqual(sent["tools"], TOOLS)
        self.assertEqual(result.content, "")
        self.assertEqual(result.tool_calls[0].id, "call-1")
        self.assertEqual(result.tool_calls[0].name, "get_system_telemetry")
        self.assertEqual(result.tool_calls[0].arguments, {"detail": "cpu"})
        self.assertEqual(result.assistant_message["tool_calls"][0]["function"]["arguments"], '{"detail": "cpu"}')

    async def test_gemini_translates_multimodal_history_tools_and_function_results(self):
        function_call = SimpleNamespace(id="gem-call-1", name="get_system_telemetry", args={"detail": "memory"})
        response = SimpleNamespace(
            candidates=[
                SimpleNamespace(
                    content=SimpleNamespace(
                        parts=[SimpleNamespace(text=None, function_call=function_call)]
                    )
                )
            ]
        )
        generate = AsyncRecorder(response)
        get_model = AsyncRecorder(SimpleNamespace(name="models/gemini-3.8-flash"))
        aio = SimpleNamespace(
            models=SimpleNamespace(generate_content=generate, get=get_model),
            aclose=AsyncRecorder(),
        )
        client = SimpleNamespace(aio=aio)
        adapter = GeminiAdapter("AIza_test_secret", client=client)
        messages = [
            {"role": "system", "content": "Sistema"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Veja"},
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,aW1hZ2U="}},
                ],
            },
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "old-call",
                        "type": "function",
                        "function": {"name": "get_system_telemetry", "arguments": '{"detail":"cpu"}'},
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "old-call",
                "name": "get_system_telemetry",
                "content": '{"status":"ok"}',
            },
        ]

        await adapter.validate_model("gemini/gemini-3.8-flash")
        result = await adapter.complete("gemini/gemini-3.8-flash", messages, TOOLS, 0.4)

        self.assertEqual(get_model.calls[0][1], {"model": "gemini-3.8-flash"})
        sent = generate.calls[0][1]
        self.assertEqual(sent["model"], "gemini-3.8-flash")
        self.assertEqual(sent["config"]["system_instruction"], "Sistema")
        self.assertEqual(sent["config"]["thinking_config"], {"thinking_level": "low"})
        self.assertEqual(sent["config"]["tools"][0]["function_declarations"][0]["name"], "get_system_telemetry")
        image_part = sent["contents"][0]["parts"][1]
        self.assertEqual(image_part["inline_data"]["mime_type"], "image/jpeg")
        self.assertEqual(image_part["inline_data"]["data"], b"image")
        function_response = sent["contents"][2]["parts"][0]["function_response"]
        self.assertEqual(function_response["name"], "get_system_telemetry")
        self.assertEqual(function_response["response"], {"status": "ok"})
        self.assertEqual(result.tool_calls[0].arguments, {"detail": "memory"})

    async def test_ollama_uses_only_loopback_and_validates_installed_model(self):
        get = AsyncRecorder(FakeHttpResponse({"models": [{"name": "qwen2.5:3b"}]}))
        post = AsyncRecorder(
            FakeHttpResponse(
                {
                    "message": {
                        "role": "assistant",
                        "content": "Tudo certo.",
                        "tool_calls": [],
                    }
                }
            )
        )
        client = SimpleNamespace(get=get, post=post, aclose=AsyncRecorder())
        adapter = OllamaAdapter(client=client)

        await adapter.validate_model("ollama/qwen2.5:3b")
        result = await adapter.complete(
            "ollama/qwen2.5:3b",
            [{"role": "user", "content": "Olá"}],
            TOOLS,
            0.4,
        )

        self.assertEqual(get.calls[0][0], ("/api/tags",))
        self.assertEqual(post.calls[0][0], ("/api/chat",))
        payload = post.calls[0][1]["json"]
        self.assertEqual(payload["model"], "qwen2.5:3b")
        self.assertFalse(payload["stream"])
        self.assertEqual(result.content, "Tudo certo.")

    async def test_missing_model_is_reported_as_model_error(self):
        client = SimpleNamespace(
            get=AsyncRecorder(FakeHttpResponse({"models": [{"name": "different:latest"}]})),
            post=AsyncRecorder(),
            aclose=AsyncRecorder(),
        )
        adapter = OllamaAdapter(client=client)

        with self.assertRaises(ProviderAdapterError) as raised:
            await adapter.validate_model("ollama/qwen2.5:3b")

        self.assertEqual(raised.exception.category, "model")
        self.assertIn("qwen2.5:3b", raised.exception.user_message)

    async def test_external_error_is_classified_without_leaking_the_key(self):
        secret = "gsk_never_expose_this_value"
        error = RuntimeError(f"401 invalid api key {secret}")
        error.status_code = 401
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncRecorder(error=error))),
            models=SimpleNamespace(retrieve=AsyncRecorder()),
        )
        adapter = GroqAdapter(secret, client=client)

        with self.assertRaises(ProviderAdapterError) as raised:
            await adapter.complete(
                "groq/openai/gpt-oss-120b",
                [{"role": "user", "content": "Olá"}],
                [],
                0.4,
            )

        self.assertEqual(raised.exception.category, "authentication")
        serialized = json.dumps({"message": str(raised.exception), "user": raised.exception.user_message})
        self.assertNotIn(secret, serialized)
        self.assertIn("credencial", raised.exception.user_message.lower())

    def test_factory_rejects_unknown_provider(self):
        with self.assertRaises(ValueError):
            create_provider_adapter("unknown", "secret")


if __name__ == "__main__":
    unittest.main()
