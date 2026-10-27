import json
import os
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from orchestration.verification import task_summary
from orchestration.executor import Executor


class DiagnosticTests(unittest.IsolatedAsyncioTestCase):
    async def test_verified_reminder_result_is_specific_and_unverified_claim_is_not_success(self):
        observation = {'capabilityId': 'reminder_create', 'status': 'succeeded', 'data': {'outcome': 'written', 'items': [{'title': 'Fixture reminder', 'nextDueUtc': '2027-01-31T09:00:00.000Z', 'timeZone': 'UTC'}]}, 'evidence': [{'kind': 'reminder_write', 'verified': True}]}
        summary = task_summary({'status': 'succeeded', 'results': {'a': observation}})
        self.assertIn('Fixture reminder', summary)
        self.assertIn('2027-01-31', summary)
        observation['status'] = 'unknown'; observation['evidence'] = []
        summary = task_summary({'status': 'unknown', 'results': {'a': observation}})
        self.assertNotIn('Lembrete criado', summary)
        postponed = {'capabilityId': 'reminder_snooze', 'status': 'succeeded', 'data': {'outcome': 'written', 'items': [{'title': 'Fixture', 'nextDueUtc': '2027-02-28T09:00:00.000Z', 'timeZone': 'UTC'}], 'affectedOccurrence': {'nominalLocalTime': '2027-01-31T09:00:00', 'snoozedUntilUtc': '2027-03-02T09:00:00.000Z'}}, 'evidence': [{'kind': 'reminder_write', 'verified': True}]}
        self.assertIn('2027-03-02', task_summary({'status': 'succeeded', 'results': {'a': postponed}}))
    def summary(self, capability, data=None, **fields):
        return task_summary({'status': 'unknown', 'results': {'a': {'capabilityId': capability, 'status': 'unknown', 'data': data, 'evidence': [], **fields}}})

    async def test_powershell_observations_are_shown_without_inventing_objective_proof(self):
        summary = self.summary('run_powershell', json.dumps({'status': 'ok', 'returncode': 0, 'stdout': 'fixture-output', 'stderr': ''}))
        self.assertIn('fixture-output', summary)
        self.assertIn('código 0', summary)
        self.assertNotIn('Tarefa verificada.', summary)
        failed = self.summary('run_powershell', {'status': 'error', 'returncode': 7, 'stdout': 'partial-output', 'stderr': 'fixture-error'})
        self.assertIn('código 7', failed); self.assertIn('fixture-error', failed); self.assertIn('partial-output', failed)
        self.assertIn('não comprovado', failed)

    async def test_gui_volume_and_broker_errors_have_specific_diagnostics(self):
        self.assertIn('click', self.summary('gui_action', {'status': 'ok', 'action': 'click'}))
        self.assertIn('50%', self.summary('control_system_volume', {'status': 'ok', 'volume_percent': 50, 'muted': True}))
        self.assertIn('Silenciado', self.summary('control_system_volume', {'status': 'ok', 'volume_percent': 50, 'muted': True}))
        self.assertIn('Tempo', self.summary('run_powershell', None, errorCode='execution_timeout'))
        self.assertIn('fixture-error', self.summary('gui_action', {'status': 'error', 'error': 'fixture-error'}))

    async def test_screenshot_and_unknown_tool_data_are_not_dumped_into_text(self):
        self.assertNotIn('BASE64_PRIVATE', self.summary('capture_screen_base64', 'BASE64_PRIVATE'))
        self.assertNotIn('PRIVATE', self.summary('unknown', {'command': 'PRIVATE'}))
        summary = self.summary('run_powershell', {'status': 'ok', 'returncode': 0, 'stdout': 'x' * 10000, 'stderr': ''})
        self.assertLess(len(summary), 5000)
        self.assertIn('truncada', summary)

    async def test_executor_binds_diagnostic_tool_name_to_plan_not_returned_claim(self):
        async def invoke(step): return {'status': 'unknown', 'data': {'status': 'ok', 'returncode': 0, 'stdout': 'fixture-output'}, 'capabilityId': 'capture_screen_base64', 'evidence': []}
        async def event(value): pass
        step = {'id': 'a', 'capabilityId': 'run_powershell', 'args': {'command': 'fixture'}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}}
        result = await Executor(invoke, event).run({'taskId': 'fixture', 'steps': [step]})
        self.assertEqual(result['results']['a']['capabilityId'], 'run_powershell')
        self.assertIn('fixture-output', task_summary(result))
        self.assertEqual(result['status'], 'unknown')
