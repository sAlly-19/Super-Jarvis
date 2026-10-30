import asyncio
import base64
import os
import sys
import unittest
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from live_session import LiveCall


class FakeSession:
    def __init__(self):
        self.messages = asyncio.Queue()
        self.send_realtime_input = AsyncMock()
        self.send_tool_response = AsyncMock()

    async def receive(self):
        yield await self.messages.get()


class LiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_web_receipts_are_private_and_interrupted_turns_do_not_revive(self):
        from web_research_notes import ResearchNotes
        from test_web_research_notes import result
        frames = []
        async def emit(frame): frames.append(frame)
        self.call.research_notes = ResearchNotes(emit, lambda: 2)
        self.call.tool_catalog = lambda: [{'type': 'function', 'function': {'name': 'web_search', 'description': 'Search', 'parameters': {'type': 'object'}}}]
        self.call.tool_executor = AsyncMock(return_value=result())
        await self.call.start('test', 'Charon', 'System')
        await self.call._tool(NS(id='web', name='web_search', args={}))
        self.assertNotIn('a' * 64, str(self.session.send_tool_response.call_args))
        await self.session.messages.put(NS(server_content=NS(turn_complete=True, output_transcription=NS(text='Answer')), tool_call=None))
        await asyncio.sleep(0.03)
        self.assertEqual([f['payload']['summary'] for f in frames], ['Answer'])
        old = self.call.turn_id
        await self.session.messages.put(NS(server_content=NS(interrupted=True), tool_call=None))
        await asyncio.sleep(0.03)
        await self.call._tool(NS(id='late', name='web_search', args={}), old)
        self.assertEqual(len(frames), 1)
        self.assertNotIn('a' * 64, str(self.events))

    async def test_private_tool_result_only_reaches_live_model_not_visual_events(self):
        self.call.tool_catalog = lambda: [{'type': 'function', 'function': {'name': 'email_read', 'description': 'Read', 'parameters': {'type': 'object'}}}]
        self.call.tool_executor = AsyncMock(return_value={'status': 'succeeded', 'data': {'body': 'private-body'}, 'evidence': []})
        await self.call.start('test', 'Charon', 'System')
        await self.call._tool(NS(id='private', name='email_read', args={'private': 'private-argument'}))
        self.assertNotIn('private-body', str(self.events))
        self.assertNotIn('private-argument', str(self.events))
        self.assertIn('private-body', str(self.session.send_tool_response.call_args))

    async def test_declared_orchestration_tool_delegates_to_runtime_executor(self):
        self.call.tool_catalog = lambda: [{'type': 'function', 'function': {'name': 'execute_task', 'description': 'Task', 'parameters': {'type': 'object'}}}]
        await self.call.start('test', 'Charon', 'System')
        await self.session.messages.put(NS(server_content=None, tool_call=NS(function_calls=[NS(id='task', name='execute_task', args={'objective': 'Read twice'})])))
        await asyncio.sleep(0.02)
        self.call.tool_executor.assert_awaited_once_with('execute_task', {'objective': 'Read twice'})
    async def test_live_projects_canonical_schema_without_weakening_original(self):
        schema = {'type': 'object', 'properties': {'action': {'type': 'string', 'enum': ['get']}},
                  'additionalProperties': False, 'required': ['action']}
        self.call.tool_catalog = lambda: [{'type': 'function', 'function': {'name': 'read', 'description': 'Read', 'parameters': schema}}]
        configs = []
        connect = self.client.aio.live.connect
        def capture(**kwargs):
            configs.append(kwargs['config'])
            return connect(**kwargs)
        self.client.aio.live.connect = capture
        await self.call.start('test', 'Charon', 'System')
        parameters = configs[0]['tools'][0]['function_declarations'][0]['parameters']
        self.assertNotIn('additionalProperties', parameters)
        self.assertEqual(parameters['properties']['action']['enum'], ['get'])
        self.assertEqual(parameters['required'], ['action'])
        self.assertIs(schema['additionalProperties'], False)

    async def test_disabled_catalog_omits_tools_and_native_calls_are_denied_by_bridge(self):
        from module_bridge import ModuleBridge
        configs = []
        connect = self.client.aio.live.connect
        def capture_config(**kwargs):
            configs.append(kwargs['config'])
            return connect(**kwargs)
        self.client.aio.live.connect = capture_config
        self.call.tool_catalog = lambda: []
        self.call.tool_executor = ModuleBridge(None).invoke
        await self.call.start('secret', 'Charon', 'Sistema')
        self.assertNotIn('tools', configs[0])
        await self.session.messages.put(NS(server_content=None, tool_call=NS(function_calls=[NS(id='denied', name='get_system_telemetry', args={})])))
        await asyncio.sleep(0.02)
        response = self.session.send_tool_response.call_args.kwargs['function_responses'][0]['response']
        self.assertEqual(response['error'], 'module_unavailable')
    async def asyncSetUp(self):
        self.events = []
        self.session = FakeSession()
        self.session.send_client_content = AsyncMock()
        self.manager = NS(__aenter__=AsyncMock(return_value=self.session), __aexit__=AsyncMock())

        class Context:
            async def __aenter__(inner):
                return await self.manager.__aenter__()

            async def __aexit__(inner, *args):
                return await self.manager.__aexit__(*args)

        self.connect = lambda **kwargs: Context()
        self.client = NS(aio=NS(live=NS(connect=self.connect), aclose=AsyncMock()), close=lambda: None)

        async def emit(kind, payload):
            self.events.append((kind, payload))

        self.call = LiveCall(emit, client_factory=lambda key: self.client, tool_executor=AsyncMock(return_value={'result': 7}))

    async def asyncTearDown(self):
        await self.call.stop()

    async def test_pcm_is_forwarded_without_wav_or_transcription(self):
        await self.call.start('secret', 'Charon', 'Sistema')
        self.call.enqueue_audio(base64.b64encode(b'\x01\x00' * 1600).decode())
        await asyncio.sleep(0.01)
        audio = self.session.send_realtime_input.call_args.kwargs['audio']
        self.assertEqual(audio['mime_type'], 'audio/pcm;rate=16000')
        self.assertEqual(len(audio['data']), 3200)

    async def test_server_audio_interruption_and_transcript_are_forwarded(self):
        await self.call.start('secret', 'Charon', 'Sistema')
        await self.session.messages.put(NS(server_content=NS(
            interrupted=True, model_turn=None, input_transcription=None,
            output_transcription=None, turn_complete=False), tool_call=None))
        await asyncio.sleep(0.01)
        await self.session.messages.put(NS(server_content=NS(
            interrupted=False, model_turn=NS(parts=[NS(inline_data=NS(data=b'\x01\x00', mime_type='audio/pcm;rate=24000'))]),
            input_transcription=NS(text='Olá'), output_transcription=NS(text='Oi'), turn_complete=True), tool_call=None))
        await asyncio.sleep(0.01)
        self.assertIn(('interrupted', {}), self.events)
        audio = next(p for k, p in self.events if k == 'audio_output')
        self.assertEqual(audio['format'], 'pcm')
        self.assertEqual(base64.b64decode(audio['audio_base64']), b'\x01\x00')
        self.assertIn(('response', {'text': 'Oi'}), self.events)
        self.assertIn(('turn_complete', {}), self.events)

    async def test_stop_closes_session_and_prevents_more_audio(self):
        await self.call.start('secret', 'Charon', 'Sistema')
        await self.call.stop()
        self.assertFalse(self.call.active)
        self.assertFalse(self.call.enqueue_audio('AAA='))
        self.manager.__aexit__.assert_awaited_once()
        self.client.aio.aclose.assert_awaited_once()

    async def test_tool_result_is_returned_to_google(self):
        with patch('live_session.AVAILABLE_FUNCTIONS', {'test_tool': lambda value: {'result': value}}):
            await self.call.start('secret', 'Charon', 'Sistema')
            await self.session.messages.put(NS(server_content=None, tool_call=NS(function_calls=[NS(id='call1', name='test_tool', args={'value': 7})])))
            await asyncio.sleep(0.02)
        result = self.session.send_tool_response.call_args.kwargs['function_responses'][0]
        self.assertEqual(result['id'], 'call1')
        self.assertEqual(result['response'], {'result': 7})

    async def test_rejects_empty_key_and_invalid_pcm(self):
        with self.assertRaises(ValueError):
            await self.call.start('', 'Charon', 'Sistema')
        await self.call.start('secret', 'Charon', 'Sistema')
        self.assertFalse(self.call.enqueue_audio('not base64'))
        self.assertFalse(self.call.enqueue_audio(base64.b64encode(b'1').decode()))

    async def test_greeting_is_generated_by_live_session(self):
        await self.call.start('secret', 'Kore', 'Sistema', greeting=True)
        self.session.send_client_content.assert_awaited_once()
        self.assertTrue(self.session.send_client_content.call_args.kwargs['turn_complete'])

    async def test_network_failure_closes_session_and_emits_safe_error(self):
        closed = asyncio.Event()
        original_emit = self.call.emit
        async def emit(kind, payload):
            await original_emit(kind, payload)
            if kind == 'status' and payload.get('status') == 'live_closed': closed.set()
        self.call.emit = emit
        await self.call.start('secret', 'Charon', 'Sistema')
        self.session.send_realtime_input.side_effect = ConnectionError('network secret')
        self.call.enqueue_audio('AAA=')
        await asyncio.wait_for(closed.wait(), timeout=2)
        self.assertFalse(self.call.active)
        self.assertIn('live_closed', [p.get('status') for k, p in self.events if k == 'status'])
        self.assertNotIn('secret', str(self.events))

    async def test_audio_queue_is_bounded_during_network_stall(self):
        await self.call.start('secret', 'Charon', 'Sistema')
        for _ in range(100):
            self.call.enqueue_audio('AAA=')
        self.assertEqual(self.call.audio.qsize(), 20)

    async def test_stop_waits_for_running_tool_cancellation_cleanup(self):
        started = asyncio.Event()
        cleaned = asyncio.Event()
        async def slow_tool(name, args):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaned.set()
        self.call.tool_executor = slow_tool
        with patch('live_session.AVAILABLE_FUNCTIONS', {'test_tool': lambda: None}):
            await self.call.start('secret', 'Charon', 'Sistema')
            await self.session.messages.put(NS(server_content=None, tool_call=NS(function_calls=[NS(id='slow', name='test_tool', args={})])))
            await asyncio.wait_for(started.wait(), 1)
            await self.call.stop()
        self.assertTrue(cleaned.is_set())
        self.session.send_tool_response.assert_not_awaited()
