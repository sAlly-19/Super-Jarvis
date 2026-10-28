import unittest
import json
from pathlib import Path
from orchestration.contracts import verifier_for
from orchestration.contracts import validate_plan
from orchestration.executor import Executor
from orchestration.diagnostics import diagnostic


class EmailModuleTests(unittest.TestCase):
    def test_email_verifiers_are_capability_bound(self):
        for name in ('search', 'read', 'conversation', 'locations', 'attachments'):
            self.assertEqual(verifier_for('email_' + name), 'email_read')
        for name in ('draft', 'send', 'reply', 'forward', 'organize', 'reconcile'):
            self.assertEqual(verifier_for('email_' + name), 'email_write')
        self.assertEqual(verifier_for('email_download_attachment'), 'email_file')
        self.assertEqual(verifier_for('email_login'), 'none')

    def test_email_diagnostic_distinguishes_accepted_unknown_and_partial_without_claiming_delivery(self):
        def observe(data, status='succeeded', verified=True):
            return diagnostic({'capabilityId': 'email_send', 'status': status, 'data': data,
                               'evidence': [{'kind': 'email_write', 'verified': verified}]})
        accepted = observe({'kind': 'write', 'operation': {'id': 'operation', 'accountId': 'account', 'state': 'accepted', 'kind': 'send'}})
        self.assertIn('account', accepted)
        self.assertIn('aceit', accepted.lower())
        unknown = observe({'kind': 'write', 'operation': {'id': 'operation', 'accountId': 'account', 'state': 'unknown', 'kind': 'send'}}, 'unknown', False)
        self.assertIn('operation', unknown)
        self.assertNotIn('conclu', unknown.lower())
        partial = diagnostic({'capabilityId': 'email_search', 'status': 'unknown', 'evidence': [], 'data': {'kind': 'read', 'value': {'items': [], 'partial': True, 'failures': [{'accountId': 'account', 'code': 'email_reauth_required'}]}}})
        self.assertIn('parcial', partial.lower())
        self.assertIn('account', partial)


if __name__ == '__main__': unittest.main()


class EmailBindingTests(unittest.IsolatedAsyncioTestCase):
    async def test_read_reply_and_draft_read_send_use_direct_aliases_without_changing_executor(self):
        catalog = {item['id']: item for item in json.loads((Path(__file__).resolve().parents[2] / 'resources/modules/native-capabilities.json').read_text(encoding='utf-8'))}
        reference = {'accountId': 'original-account', 'messageId': 'same-message-id'}
        def step(name, capability, args, dependencies, bindings):
            return {'id': name, 'capabilityId': capability, 'args': args, 'dependsOn': dependencies, 'bindings': bindings,
                    'successCriterion': {'verifierId': verifier_for(capability), 'expected': None}}
        def bind(field, source, output): return {'inputField': field, 'fromStepId': source, 'outputField': output}
        plans = [
            [step('read', 'email_read', {'ref': reference}, [], []), step('reply', 'email_reply', {'text': 'Synthetic', 'attachmentHandles': []}, ['read'], [bind('ref', 'read', 'ref'), bind('expectedVersion', 'read', 'version')])],
            [step('draft', 'email_draft', {'request': {'type': 'draft_create', 'composition': {'to': ['synthetic@example.invalid'], 'cc': [], 'bcc': [], 'subject': 'Synthetic', 'text': '', 'attachmentHandles': []}}}, [], []),
             step('read', 'email_read', {}, ['draft'], [bind('ref', 'draft', 'draftRef')]), step('send', 'email_send', {}, ['read'], [bind('draftRef', 'read', 'ref'), bind('expectedVersion', 'read', 'version')])]
        ]
        for steps in plans:
            calls = []
            async def invoke(current):
                calls.append(current['capabilityId'])
                if current['capabilityId'] in ('email_reply', 'email_send'):
                    self.assertEqual(current['args']['expectedVersion'], 'read-ticket')
                    self.assertEqual(current['args'].get('ref', current['args'].get('draftRef')), reference)
                data = {'ref': reference, 'version': 'read-ticket'} if current['capabilityId'] == 'email_read' else {'draftRef': reference, 'operationId': 'synthetic-operation'}
                return {'status': 'succeeded', 'data': data, 'evidence': [{'kind': verifier_for(current['capabilityId']), 'verified': True}]}
            async def event(_value): pass
            result = await Executor(invoke, event).run(validate_plan({'taskId': 'synthetic', 'revision': 0, 'steps': steps}, catalog))
            self.assertEqual(result['status'], 'succeeded'); self.assertEqual(len(calls), len(steps))
