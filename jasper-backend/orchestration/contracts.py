import copy
import math
import re

LIMITS = {'max_steps': 8, 'timeout_seconds': 120, 'max_revisions': 2}


def validate_value(value, schema):
    kind = schema['type']
    kinds = kind if isinstance(kind, list) else [kind]
    matches = {'object': isinstance(value, dict), 'array': isinstance(value, list),
               'string': isinstance(value, str), 'integer': type(value) is int,
               'number': type(value) in (int, float) and math.isfinite(value),
               'boolean': type(value) is bool, 'null': value is None}
    if not any(matches.get(item, False) for item in kinds): raise ValueError('invalid_plan_argument')
    if 'enum' in schema and value not in schema['enum']: raise ValueError('invalid_plan_argument')
    if isinstance(value, dict):
        properties = schema.get('properties', {})
        if not set(schema.get('required', [])) <= set(value): raise ValueError('missing_plan_argument')
        if schema.get('additionalProperties') is False and set(value) - set(properties): raise ValueError('extra_plan_argument')
        for name, item in value.items():
            if name in properties: validate_value(item, properties[name])
    if isinstance(value, list) and 'items' in schema:
        for item in value: validate_value(item, schema['items'])
    if type(value) in (int, float):
        if 'minimum' in schema and value < schema['minimum']: raise ValueError('invalid_plan_argument')
        if 'maximum' in schema and value > schema['maximum']: raise ValueError('invalid_plan_argument')
    if isinstance(value, (str, list)):
        suffix = 'Length' if isinstance(value, str) else 'Items'
        if len(value) < schema.get('min' + suffix, 0) or len(value) > schema.get('max' + suffix, 1000000): raise ValueError('invalid_plan_argument')


def validate_plan(plan, catalog, limits=None):
    limits = limits or LIMITS
    if not isinstance(plan, dict) or set(plan) != {'taskId', 'revision', 'steps'}: raise ValueError('invalid_plan')
    if not isinstance(plan['taskId'], str) or not 0 < len(plan['taskId']) <= 160: raise ValueError('invalid_task_id')
    if type(plan['revision']) is not int or not 0 <= plan['revision'] <= limits['max_revisions']: raise ValueError('plan_revision_limit')
    steps = plan['steps']
    if not isinstance(steps, list) or not 1 <= len(steps) <= limits['max_steps']: raise ValueError('plan_limit')
    seen = set()
    for step in steps:
        if not isinstance(step, dict) or set(step) != {'id', 'capabilityId', 'args', 'dependsOn', 'bindings', 'successCriterion'}: raise ValueError('invalid_step')
        if not isinstance(step['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', step['id']) or step['id'] in seen: raise ValueError('duplicate_or_invalid_step')
        capability = catalog.get(step['capabilityId'])
        if capability is None: raise ValueError('unknown_capability')
        deps = step['dependsOn']
        if not isinstance(deps, list) or any(not isinstance(dep, str) or dep not in seen for dep in deps) or len(set(deps)) != len(deps): raise ValueError('invalid_dependencies')
        if not isinstance(step['bindings'], list): raise ValueError('invalid_bindings')
        args = copy.deepcopy(step['args'])
        if not isinstance(args, dict): raise ValueError('invalid_plan_argument')
        for binding in step['bindings']:
            if not isinstance(binding, dict) or set(binding) != {'inputField', 'fromStepId', 'outputField'}: raise ValueError('invalid_binding')
            if any(not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) for value in binding.values()): raise ValueError('invalid_binding')
            if binding['fromStepId'] not in deps: raise ValueError('binding_not_dependency')
            if step['capabilityId'] == 'run_powershell': raise ValueError('shell_binding')
            if binding['inputField'] in args: raise ValueError('binding_overwrites_input')
        # Main validates again after binding resolution. Validate static fields now.
        schema = copy.deepcopy(capability['inputSchema'])
        schema['required'] = [name for name in schema.get('required', []) if name not in {b['inputField'] for b in step['bindings']}]
        validate_value(args, schema)
        criterion = step['successCriterion']
        if not isinstance(criterion, dict) or set(criterion) != {'verifierId', 'expected'} or criterion['verifierId'] not in ('none', 'telemetry_read'): raise ValueError('unknown_verifier')
        if criterion['verifierId'] == 'telemetry_read' and step['capabilityId'] != 'get_system_telemetry': raise ValueError('verifier_mismatch')
        if criterion['expected'] is not None: raise ValueError('unsupported_success_criterion')
        seen.add(step['id'])
    return copy.deepcopy(plan)
