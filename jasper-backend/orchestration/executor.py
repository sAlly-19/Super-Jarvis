import asyncio
import copy
from .contracts import LIMITS
from .verification import Verification


class Executor:
    def __init__(self, invoke, event, timeout_seconds=LIMITS['timeout_seconds']):
        self.invoke, self.event, self.timeout = invoke, event, timeout_seconds

    async def run(self, plan, context=None):
        states = {step['id']: 'pending' for step in plan['steps']}
        outputs = {}
        results = {}
        started = False
        try:
            async with asyncio.timeout(self.timeout):
                for source in plan['steps']:
                    if any(states[dep] != 'succeeded' for dep in source['dependsOn']):
                        states[source['id']] = 'skipped'; continue
                    step = copy.deepcopy(source)
                    for binding in step['bindings']:
                        output = outputs[binding['fromStepId']]
                        if not isinstance(output, dict) or binding['outputField'] not in output: raise ValueError('binding_output_unavailable')
                        step['args'][binding['inputField']] = copy.deepcopy(output[binding['outputField']])
                    await self.event({'type': 'step_started', 'stepId': step['id']})
                    started = True
                    states[step['id']] = 'running'
                    result = await self.invoke(step)
                    results[step['id']] = result
                    status = Verification.verify(step, result)
                    states[step['id']] = status
                    if status == 'succeeded': outputs[step['id']] = result.get('data')
                    await self.event({'type': 'step_finished', 'stepId': step['id'], 'status': status})
        except (asyncio.CancelledError, TimeoutError):
            for step_id, status in list(states.items()):
                if status == 'running':
                    states[step_id] = 'unknown'
                    await self.event({'type': 'step_finished', 'stepId': step_id, 'status': 'unknown'})
            final = 'unknown' if started else 'cancelled'
        except Exception:
            for step_id, status in list(states.items()):
                if status == 'running':
                    states[step_id] = 'unknown'
                    await self.event({'type': 'step_finished', 'stepId': step_id, 'status': 'unknown'})
            final = 'unknown' if started else 'failed'
        else:
            values = list(states.values())
            final = ('unknown' if 'unknown' in values else 'succeeded' if all(value == 'succeeded' for value in values)
                     else 'partial' if 'succeeded' in values else 'failed')
        states = {key: 'skipped' if value == 'pending' else value for key, value in states.items()}
        await self.event({'type': 'finished', 'status': final})
        return {'status': final, 'steps': states, 'results': results}
