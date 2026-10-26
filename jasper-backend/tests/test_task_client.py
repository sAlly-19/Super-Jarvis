import asyncio
import os
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from orchestration.client import TaskClient


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_lost_started_ack_reconciles_without_dispatch_or_orphan_running_task(self):
        host = {'revision': 0, 'status': 'queued', 'running': False}
        async def emit(frame): pass
        async def invoke(*args, **kwargs): self.fail('Effect dispatched without ack')
        client = TaskClient(emit, invoke); client.configure(1)
        async def exchange(task_id, revision, event):
            kind = event['type']
            if kind == 'open': return {'taskId': 'host-task', 'revision': 0, 'accepted': True}
            if kind == 'abandoned':
                host['status'] = 'unknown'; host['running'] = False; host['revision'] += 1
            elif kind == 'step_started':
                host['running'] = True; host['revision'] += 1; raise TimeoutError('Ack lost after commit')
            elif kind == 'finished' and host['running']:
                return {'taskId': 'host-task', 'revision': host['revision'], 'accepted': False}
            else: host['revision'] += 1
            return {'taskId': 'host-task', 'revision': host['revision'], 'accepted': True}
        client._exchange = exchange
        async def plan(task_id):
            return {'taskId': task_id, 'steps': [{'id': 'a', 'capabilityId': 'run_powershell', 'args': {}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}}]}
        try: await client.run('chat', plan)
        except ValueError: pass
        self.assertFalse(host['running'])
        self.assertEqual(host['status'], 'unknown')
        self.assertFalse(client.jobs)
    async def test_runtime_negotiates_task_extension_before_using_orchestrator(self):
        from runtime import JasperRuntime
        runtime = JasperRuntime()
        frames = [frame async for frame in runtime.handle({'version': 1, 'id': 'tasks', 'type': 'task_runtime', 'payload': {'taskRuntimeVersion': 1, 'sessionId': 4}})]
        self.assertEqual(frames[0]['type'], 'task_runtime_ack')
        self.assertEqual(runtime.tasks.session_id, 4)
    async def test_host_ack_precedes_dispatch_and_live_close_preserves_chat(self):
        events, calls = [], []
        client = None
        async def emit(frame):
            p = frame['payload']; events.append(p['event']['type'])
            client.ack({'requestId': p['requestId'], 'accepted': True, 'taskId': p['taskId'] or 'host-task',
                        'revision': 0 if p['event']['type'] == 'open' else p['expectedRevision'] + 1})
        async def invoke(capability, args, task=None):
            self.assertEqual(events[-1], 'step_started'); calls.append(task)
            return {'status': 'unknown', 'data': 'process finished', 'evidence': []}
        client = TaskClient(emit, invoke)
        client.configure(1)
        async def plan(task_id):
            return {'taskId': task_id, 'revision': 0, 'steps': [{'id': 'a', 'capabilityId': 'run_powershell', 'args': {}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}}]}
        result = await client.run('chat', plan)
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(calls, [{'taskId': 'host-task', 'stepId': 'a'}])
        self.assertEqual(events, ['open', 'planning', 'plan_ready', 'step_started', 'step_finished', 'finished'])
        chat = asyncio.create_task(asyncio.sleep(10))
        live = asyncio.create_task(asyncio.sleep(10))
        client.jobs = {'chat': ('chat', chat), 'live': ('live', live)}
        await client.close_origin('live')
        self.assertTrue(live.cancelled()); self.assertFalse(chat.done())
        chat.cancel(); await asyncio.gather(chat, return_exceptions=True)
