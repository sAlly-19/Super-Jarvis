import unittest
from orchestration.contracts import verifier_for
from orchestration.verification import Verification
from orchestration.diagnostics import diagnostic

class PcHealthTests(unittest.TestCase):
    def test_only_host_evidence_verifies_health_read(self):
        step = {'successCriterion': {'verifierId': 'pc_health_read'}}
        self.assertEqual(verifier_for('pc_health_read'), 'pc_health_read')
        self.assertEqual(Verification.verify(step, {'status': 'unknown', 'data': {'cpuPercent': 0}}), 'unknown')
        self.assertEqual(Verification.verify(step, {'status': 'succeeded', 'evidence': [{'kind': 'pc_health_read', 'verified': True}]}), 'succeeded')

    def test_partial_health_diagnostic_does_not_invent_sensors(self):
        text = diagnostic({'capabilityId': 'pc_health_read', 'data': {'snapshot': {'cpuPercent': 20, 'memory': None, 'unavailable': ['temperature']}}})
        self.assertIn('20.0%', text)
        self.assertIn('temperature', text)
        self.assertNotIn('RAM: 0', text)
