import asyncio
import os
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from orchestration.executor import Executor
from orchestration.verification import Verification
from orchestration.verification import task_summary


class ExecutorTests(unittest.IsolatedAsyncioTestCase):
    async def test_verified_telemetry_summary_preserves_observed_values(self):
        summary = task_summary({'status': 'succeeded', 'results': {'a': {'status': 'succeeded', 'data': {'cpu_percent': 71.5, 'ram': {'percent': 42}, 'disk_c': {'percent': 23}}, 'evidence': [{'kind': 'telemetry_read', 'verified': True}]}}})
        self.assertIn('71.5', summary)
        self.assertIn('42', summary)
        self.assertIn('23', summary)
    async def test_unknown_effect_blocks_dependents_and_is_never_retried(self):
        calls, events = [], []
        async def invoke(step):
            calls.append(step['id']); return {'status': 'unknown', 'data': 'exit code 0', 'evidence': []}
        async def event(value): events.append(value)
        plan = {'taskId': 't', 'revision': 0, 'steps': [
            {'id': 'a', 'capabilityId': 'run_powershell', 'args': {}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}},
            {'id': 'b', 'capabilityId': 'run_powershell', 'args': {}, 'dependsOn': ['a'], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}}]}
        result = await Executor(invoke, event).run(plan)
        self.assertEqual(calls, ['a'])
        self.assertEqual(result['status'], 'unknown')
        self.assertEqual(result['steps']['b'], 'skipped')
        self.assertEqual(Verification.verify(plan['steps'][0], {'status': 'succeeded', 'data': 'exit 0', 'evidence': []}), 'unknown')

    async def test_cancel_waits_for_executor_cleanup_and_never_starts_next_step(self):
        started, cleaned = asyncio.Event(), asyncio.Event()
        async def invoke(step):
            started.set()
            try: await asyncio.Event().wait()
            finally: cleaned.set()
        async def event(value): pass
        plan = {'taskId': 't', 'steps': [{'id': 'a', 'args': {}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}}]}
        task = asyncio.create_task(Executor(invoke, event).run(plan))
        await started.wait(); task.cancel()
        result = await task
        self.assertTrue(cleaned.is_set())
        self.assertEqual(result['status'], 'unknown')

