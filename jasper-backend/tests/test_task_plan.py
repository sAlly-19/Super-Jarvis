import copy
import os
import sys
import unittest
import json
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from orchestration.contracts import validate_plan

CATALOG = {'run_powershell': {'inputSchema': {'type': 'object', 'properties': {'command': {'type': 'string'}}, 'required': ['command'], 'additionalProperties': False}, 'outputSchema': {'type': 'string'}}}

def step(name, dependencies=None):
    return {'id': name, 'capabilityId': 'run_powershell', 'args': {'command': 'test'}, 'dependsOn': dependencies or [], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}}


class PlanTests(unittest.TestCase):
    def test_reminder_verifiers_match_only_their_registered_main_capabilities(self):
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'resources', 'modules', 'native-capabilities.json'), encoding='utf-8') as source:
            catalog = {item['id']: item for item in json.load(source)}
        create = {'id': 'a', 'capabilityId': 'reminder_create', 'args': {'title': 'Fixture', 'schedule': {'policy': 'jasper', 'localDateTime': '2027-01-31T09:00:00', 'timeZone': 'UTC', 'recurrence': 'none', 'anchorDay': 31}}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'reminder_write', 'expected': None}}
        read = {'id': 'b', 'capabilityId': 'reminder_get', 'args': {}, 'dependsOn': ['a'], 'bindings': [{'inputField': 'id', 'fromStepId': 'a', 'outputField': 'id'}], 'successCriterion': {'verifierId': 'reminder_read', 'expected': None}}
        plan = {'taskId': 'fixture', 'revision': 0, 'steps': [create, read]}
        self.assertEqual(validate_plan(plan, catalog), plan)
        create['successCriterion']['verifierId'] = 'reminder_read'
        with self.assertRaises(ValueError): validate_plan(plan, catalog)
    def test_plan_rejects_cycles_duplicates_unknown_capabilities_and_excess_steps(self):
        valid = {'taskId': 'task', 'revision': 0, 'steps': [step('a'), step('b', ['a'])]}
        self.assertEqual(validate_plan(valid, CATALOG)['steps'][1]['id'], 'b')
        cases = []
        cyclic = copy.deepcopy(valid); cyclic['steps'][0]['dependsOn'] = ['b']; cases.append(cyclic)
        duplicate = copy.deepcopy(valid); duplicate['steps'][1]['id'] = 'a'; cases.append(duplicate)
        unknown = copy.deepcopy(valid); unknown['steps'][0]['capabilityId'] = 'grant_permission'; cases.append(unknown)
        missing = copy.deepcopy(valid); missing['steps'][1]['dependsOn'] = ['absent']; cases.append(missing)
        extra = copy.deepcopy(valid); extra['steps'] = [step(str(i)) for i in range(9)]; cases.append(extra)
        injected = copy.deepcopy(valid); injected['authorized'] = True; cases.append(injected)
        for plan in cases:
            with self.subTest(plan=plan), self.assertRaises(ValueError): validate_plan(plan, CATALOG)

    def test_bindings_never_interpolate_shell_and_require_prior_validated_dependency(self):
        plan = {'taskId': 'task', 'revision': 0, 'steps': [step('a'), step('b', ['a'])]}
        plan['steps'][1]['bindings'] = [{'inputField': 'command', 'fromStepId': 'a', 'outputField': 'text'}]
        with self.assertRaisesRegex(ValueError, 'shell_binding'): validate_plan(plan, CATALOG)
        plan['steps'][1]['bindings'][0]['fromStepId'] = 'future'
        with self.assertRaises(ValueError): validate_plan(plan, CATALOG)

