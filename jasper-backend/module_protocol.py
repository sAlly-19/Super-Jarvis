"""Strict validation for the private modular extension of envelope v1."""
FIELDS = {
    'module_snapshot': {'moduleRuntimeVersion', 'snapshotVersion', 'sessionId', 'capabilities'},
    'module_snapshot_ack': {'moduleRuntimeVersion', 'snapshotVersion'},
    'capability_request': {'requestId', 'snapshotVersion', 'capabilityId', 'args'},
    'capability_cancel_request': {'requestId'},
    'capability_execute': {'requestId', 'context', 'capabilityId', 'args', 'snapshotVersion'},
    'capability_result': {'context', 'result'},
    'capability_response': {'requestId', 'result'},
    'invocation_cancel': {'invocationId', 'reason'},
}


def validate_module_payload(kind, payload):
    if kind not in FIELDS:
        return False
    optional = {'task'} if kind == 'capability_request' else set()
    if not isinstance(payload, dict) or not FIELDS[kind] <= set(payload) or set(payload) - FIELDS[kind] - optional:
        raise ValueError('invalid_module_fields')
    for name in ('requestId', 'capabilityId', 'invocationId', 'reason'):
        if name in payload and (not isinstance(payload[name], str) or not 0 < len(payload[name]) <= 160):
            raise ValueError('invalid_module_string')
    for name in ('snapshotVersion', 'sessionId'):
        if name in payload and (type(payload[name]) is not int or not 0 <= payload[name] <= 9007199254740991):
            raise ValueError('invalid_module_integer')
    if 'moduleRuntimeVersion' in payload and (type(payload['moduleRuntimeVersion']) is not int or payload['moduleRuntimeVersion'] != 1):
        raise ValueError('incompatible_module_runtime')
    if 'args' in payload and not isinstance(payload['args'], dict):
        raise ValueError('invalid_module_arguments')
    if 'task' in payload:
        task = payload['task']
        if not isinstance(task, dict) or set(task) != {'taskId', 'stepId'} or any(not isinstance(x, str) or not 0 < len(x) <= 160 for x in task.values()):
            raise ValueError('invalid_task_binding')
    if 'context' in payload:
        context = payload['context']
        if not isinstance(context, dict) or set(context) != {'taskId', 'stepId', 'invocationId', 'sessionId', 'moduleRevision'}:
            raise ValueError('invalid_execution_context')
        for name in ('taskId', 'stepId', 'invocationId'):
            if not isinstance(context[name], str) or not 0 < len(context[name]) <= 160:
                raise ValueError('invalid_execution_id')
        for name in ('sessionId', 'moduleRevision'):
            if type(context[name]) is not int or not 0 <= context[name] <= 9007199254740991:
                raise ValueError('invalid_execution_revision')
    if 'result' in payload:
        result = payload['result']
        if (not isinstance(result, dict) or not {'status', 'evidence'} <= set(result)
                or set(result) - {'status', 'evidence', 'data', 'errorCode'}
                or result['status'] not in ('succeeded', 'failed', 'cancelled', 'unknown')
                or not isinstance(result['evidence'], list) or any(not isinstance(item, dict) for item in result['evidence'])):
            raise ValueError('invalid_capability_result')
        if 'errorCode' in result and (not isinstance(result['errorCode'], str) or not 0 < len(result['errorCode']) <= 160):
            raise ValueError('invalid_module_error_code')
    if 'capabilities' in payload:
        if not isinstance(payload['capabilities'], list):
            raise ValueError('invalid_capability_catalog')
        seen = set()
        for item in payload['capabilities']:
            if (not isinstance(item, dict) or not isinstance(item.get('id'), str)
                    or not isinstance(item.get('description'), str) or not isinstance(item.get('inputSchema'), dict)
                    or item['id'] in seen):
                raise ValueError('invalid_capability_catalog')
            seen.add(item['id'])
    return True
