import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from module_bridge import ModuleBridge
from runtime import JasperRuntime
from provider_adapters import ProviderResponse, ProviderToolCall


class ModuleBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_grants_are_correlated_single_use_and_cancelling_request_waits_for_worker_cleanup(self):
        sent = []
        started = asyncio.Event()
        cleaned = asyncio.Event()
        cleanup_started = asyncio.Event()
        calls = 0
        async def emit(frame): sent.append(frame)
        async def execute(name, args):
            nonlocal calls
            calls += 1
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleanup_started.set()
                await asyncio.sleep(0.02)
                cleaned.set()
        bridge = ModuleBridge(emit, executor=execute)
        capability = {'id': 'get_system_telemetry', 'description': 'Read telemetry', 'inputSchema': {'type': 'object', 'properties': {}}}
        await bridge.snapshot({'moduleRuntimeVersion': 1, 'snapshotVersion': 1, 'sessionId': 1, 'capabilities': [capability]}, 'snapshot')
        task = asyncio.create_task(bridge.invoke('get_system_telemetry', {}))
        await asyncio.sleep(0)
        request_id = sent[-1]['payload']['requestId']
        grant = {'requestId': request_id, 'snapshotVersion': 1, 'capabilityId': 'get_system_telemetry', 'args': {},
            'context': {'invocationId': 'inv', 'taskId': 'task', 'stepId': 'step', 'sessionId': 1, 'moduleRevision': 0}}
        await bridge.execute(grant, 'grant')
        await started.wait()
        await bridge.execute(grant, 'replayed')
        self.assertEqual(calls, 1)
        task.cancel()
        await cleanup_started.wait()
        await bridge.cancel('inv')
        with self.assertRaises(asyncio.CancelledError): await task
        self.assertTrue(cleaned.is_set())
        await bridge.close()
    async def test_runtime_text_and_automatic_capture_do_not_bypass_disabled_module(self):
        sent = []
        async def emit(frame): sent.append(frame)
        runtime = JasperRuntime(event_sink=emit)
        runtime.config['api_key'] = 'test-key'
        runtime.config['vision_enabled'] = True
        runtime.provider_adapter = type('Adapter', (), {'complete': AsyncMock(side_effect=[
            ProviderResponse('', [ProviderToolCall('call', 'get_system_telemetry', {})], {'role': 'assistant', 'content': ''}),
            ProviderResponse('Sem acesso ao módulo.', [], {'role': 'assistant', 'content': 'Sem acesso ao módulo.'})
        ])})()
        with patch('runtime.capture_screen_base64') as capture, patch.dict('runtime.AVAILABLE_FUNCTIONS', {'get_system_telemetry': lambda: self.fail('Bypass executed')}), patch('runtime.generate_tts_base64', new_callable=AsyncMock, return_value=''):
            replies = [frame async for frame in runtime.handle({'version': 1, 'id': 'chat', 'type': 'chat', 'payload': {'text': 'Veja a tela'}})]
            capture.assert_not_called()
        tool_result = next(frame for frame in replies if frame['type'] == 'tool_result')
        self.assertIn('module_unavailable', str(tool_result['payload']['result']))
    async def test_no_snapshot_or_disabled_capability_never_dispatches(self):
        sent = []
        async def emit(frame): sent.append(frame)
        bridge = ModuleBridge(emit)
        self.assertEqual((await bridge.invoke('run_powershell', {'command': 'test'}))['error'], 'module_unavailable')
        await bridge.snapshot({'moduleRuntimeVersion': 1, 'snapshotVersion': 1, 'sessionId': 1, 'capabilities': []}, 'snap-1')
        self.assertEqual((await bridge.invoke('run_powershell', {'command': 'test'}))['error'], 'module_unavailable')
        self.assertEqual([frame['type'] for frame in sent], ['module_snapshot_ack'])

    async def test_host_response_completes_pending_request_without_local_tool_execution(self):
        sent = []
        async def emit(frame): sent.append(frame)
        bridge = ModuleBridge(emit)
        capability = {'id': 'get_system_telemetry', 'description': 'Read telemetry', 'inputSchema': {'type': 'object', 'properties': {}, 'required': [], 'additionalProperties': False}}
        await bridge.snapshot({'moduleRuntimeVersion': 1, 'snapshotVersion': 1, 'sessionId': 1, 'capabilities': [capability]}, 'snap')
        task = asyncio.create_task(bridge.invoke('get_system_telemetry', {}))
        await asyncio.sleep(0)
        request = sent[-1]
        self.assertEqual(request['type'], 'capability_request')
        bridge.respond({'requestId': request['payload']['requestId'], 'result': {'status': 'unknown', 'data': 'telemetry', 'evidence': []}})
        self.assertEqual(await task, {'status': 'unknown', 'data': 'telemetry', 'evidence': []})
        await bridge.snapshot({'moduleRuntimeVersion': 1, 'snapshotVersion': 2, 'sessionId': 1, 'capabilities': []}, 'snap2')
        self.assertEqual(bridge.tools(), [])

    async def test_snapshot_change_invalidates_waiters_and_stale_response_is_ignored(self):
        sent = []
        async def emit(frame): sent.append(frame)
        bridge = ModuleBridge(emit)
        capability = {'id': 'get_system_telemetry', 'description': 'Read telemetry', 'inputSchema': {'type': 'object', 'properties': {}}}
        await bridge.snapshot({'moduleRuntimeVersion': 1, 'snapshotVersion': 1, 'sessionId': 1, 'capabilities': [capability]}, 'snap')
        task = asyncio.create_task(bridge.invoke('get_system_telemetry', {}))
        await asyncio.sleep(0)
        old = sent[-1]['payload']['requestId']
        await bridge.snapshot({'moduleRuntimeVersion': 1, 'snapshotVersion': 2, 'sessionId': 1, 'capabilities': []}, 'snap2')
        bridge.respond({'requestId': old, 'result': {'data': 'late'}})
        self.assertEqual((await task)['error'], 'module_snapshot_changed')
