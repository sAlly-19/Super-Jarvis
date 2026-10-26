FIELDS = {
    'task_runtime': {'taskRuntimeVersion', 'sessionId'}, 'task_runtime_ack': {'taskRuntimeVersion', 'sessionId'},
    'task_cancel': {'taskId'},
    'task_event': {'requestId', 'sessionId', 'taskId', 'expectedRevision', 'event'},
    'task_event_ack': {'requestId', 'taskId', 'revision', 'accepted'},
}
EVENTS = {'open': {'type', 'origin'}, 'abandoned': {'type', 'sequence'}, 'planning': {'type', 'sequence'}, 'plan_ready': {'type', 'sequence', 'stepIds'},
          'step_started': {'type', 'sequence', 'stepId'}, 'step_finished': {'type', 'sequence', 'stepId', 'status'},
          'cancel_requested': {'type', 'sequence'}, 'finished': {'type', 'sequence', 'status'}}


def validate_task_payload(kind, payload):
    if kind not in FIELDS: return False
    optional = {'errorCode'} if kind == 'task_event_ack' else set()
    if not isinstance(payload, dict) or not FIELDS[kind] <= set(payload) or set(payload) - FIELDS[kind] - optional: raise ValueError('invalid_task_fields')
    for name in ('sessionId', 'revision', 'expectedRevision'):
        if name in payload and (type(payload[name]) is not int or not 0 <= payload[name] <= 9007199254740991): raise ValueError('invalid_task_integer')
    for name in ('requestId', 'taskId', 'errorCode'):
        if name in payload and (not isinstance(payload[name], str) or len(payload[name]) > 160 or not payload[name] and name != 'taskId'): raise ValueError('invalid_task_string')
    if 'taskRuntimeVersion' in payload and (type(payload['taskRuntimeVersion']) is not int or payload['taskRuntimeVersion'] != 1): raise ValueError('invalid_task_version')
    if 'accepted' in payload and type(payload['accepted']) is not bool: raise ValueError('invalid_task_ack')
    if kind == 'task_event':
        event = payload['event']
        if not isinstance(event, dict) or event.get('type') not in EVENTS or set(event) != EVENTS[event['type']]: raise ValueError('invalid_task_event')
        if event['type'] == 'open' and event['origin'] not in ('chat', 'live'): raise ValueError('invalid_task_origin')
        if 'sequence' in event and (type(event['sequence']) is not int or not 1 <= event['sequence'] <= 9007199254740991): raise ValueError('invalid_task_sequence')
        if 'stepId' in event and (not isinstance(event['stepId'], str) or not 0 < len(event['stepId']) <= 160): raise ValueError('invalid_task_step')
        if 'stepIds' in event and (not isinstance(event['stepIds'], list) or not 1 <= len(event['stepIds']) <= 8 or any(not isinstance(x, str) or not 0 < len(x) <= 160 for x in event['stepIds'])): raise ValueError('invalid_task_steps')
        if 'status' in event and event['status'] not in ('succeeded', 'failed', 'cancelled', 'skipped', 'unknown', 'partial', 'interrupted'): raise ValueError('invalid_task_status')
    return True
