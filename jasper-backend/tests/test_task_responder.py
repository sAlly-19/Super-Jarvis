import asyncio
import json
import os
import sys
import unittest
from types import SimpleNamespace
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from orchestration.responder import compose_task_response


class ResponderTests(unittest.IsolatedAsyncioTestCase):
    def result(self):
        return {'status': 'unknown', 'results': {'a': {'capabilityId': 'run_powershell', 'status': 'unknown', 'data': json.dumps({'status': 'ok', 'returncode': 0, 'stdout': 'Arraias, Tocantins: nublado, 25°C', 'stderr': ''}), 'evidence': []}}}

    async def test_contextual_reply_uses_selected_model_no_tools_and_preserves_state(self):
        original = self.result()
        before = json.dumps(original)
        async def complete(model, messages, tools, temperature):
            self.assertEqual(model, 'selected-model'); self.assertEqual(tools, [])
            self.assertIn('Como está o clima?', messages[-1]['content'])
            self.assertIn('Arraias', messages[-1]['content'])
            return SimpleNamespace(content='Em Arraias está nublado e faz 25 °C.', tool_calls=[])
        text = await compose_task_response(SimpleNamespace(complete=complete), 'selected-model', 'Como está o clima?', original)
        self.assertEqual(text, 'Em Arraias está nublado e faz 25 °C.')
        self.assertEqual(json.dumps(original), before)

    async def test_failed_empty_or_tool_call_reply_falls_back_without_retry(self):
        for mode in ('error', 'empty', 'tool'):
            calls = []
            async def complete(*args):
                calls.append(args)
                if mode == 'error': raise RuntimeError('fixture')
                return SimpleNamespace(content='' if mode == 'empty' else 'ignore', tool_calls=['unexpected'] if mode == 'tool' else [])
            text = await compose_task_response(SimpleNamespace(complete=complete), 'selected', 'Clima?', self.result())
            self.assertIn('Arraias', text)
            self.assertNotIn('Execução encerrada', text)
            self.assertNotIn('código 0', text)
            self.assertEqual(len(calls), 1)

    async def test_cancellation_propagates_and_image_bytes_are_excluded(self):
        result = self.result()
        result['results']['b'] = {'capabilityId': 'capture_screen_base64', 'status': 'unknown', 'data': 'PRIVATE_BASE64', 'evidence': []}
        async def complete(model, messages, tools, temperature):
            self.assertNotIn('PRIVATE_BASE64', str(messages))
            raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await compose_task_response(SimpleNamespace(complete=complete), 'selected', 'Clima?', result)

    async def test_redaction_failure_preserves_verified_telemetry_observation(self):
        async def complete(*args): raise RuntimeError('fixture')
        result = {'status': 'succeeded', 'results': {'a': {'capabilityId': 'get_system_telemetry', 'status': 'succeeded', 'data': {'cpu_percent': 12, 'ram': {'percent': 45}, 'disk_c': {'percent': 67}}, 'evidence': [{'kind': 'telemetry_read', 'verified': True}]}}}
        text = await compose_task_response(SimpleNamespace(complete=complete), 'selected', 'Uso do computador?', result)
        for value in ('12', '45', '67'): self.assertIn(value, text)

    async def test_slow_redaction_times_out_without_retrying_the_action(self):
        from unittest.mock import patch
        native_timeout = asyncio.timeout
        calls = []
        async def complete(*args):
            calls.append(args)
            await asyncio.sleep(10)
        with patch('orchestration.responder.asyncio.timeout', side_effect=lambda seconds: native_timeout(0.001)) as timeout:
            text = await compose_task_response(SimpleNamespace(complete=complete), 'selected', 'Clima?', self.result())
            timeout.assert_called_once_with(15)
        self.assertEqual(len(calls), 1)
        self.assertIn('Arraias', text)
