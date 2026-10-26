import asyncio
import uuid
from .executor import Executor
from .contracts import LIMITS


class TaskClient:
    def __init__(self, emit, invoke):
        self.emit, self.invoke = emit, invoke
        self.session_id = None
        self.pending, self.jobs = {}, {}
        self.cancelled = set()
        self.closing = False

    def begin_shutdown(self):
        self.closing = True
        for future in list(self.pending.values()):
            if not future.done(): future.set_exception(ValueError('task_runtime_closed'))

    def configure(self, session_id): self.session_id = session_id

    def ack(self, payload):
        future = self.pending.get(payload['requestId'])
        if future is not None and not future.done(): future.set_result(payload)

    async def _exchange(self, task_id, revision, event):
        if self.closing: raise ValueError('task_runtime_closed')
        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            await self.emit({'version': 1, 'id': request_id, 'type': 'task_event', 'payload': {
                'requestId': request_id, 'sessionId': self.session_id, 'taskId': task_id,
                'expectedRevision': revision, 'event': event}})
            return await asyncio.wait_for(future, 5)
        finally: self.pending.pop(request_id, None)

    async def run(self, origin, build_plan):
        if self.session_id is None: raise ValueError('task_runtime_not_negotiated')
        opened = await self._exchange('', 0, {'type': 'open', 'origin': origin})
        if not opened['accepted']: raise ValueError('task_open_denied')
        task_id = opened['taskId']
        revision = opened['revision']
        terminal = False

        async def event(value):
            nonlocal revision, terminal
            for attempt in range(2):
                value = {**value, 'sequence': revision + 1}
                work = asyncio.create_task(self._exchange(task_id, revision, value))
                try: ack = await asyncio.shield(work)
                except asyncio.CancelledError:
                    self.cancelled.add(task_id)
                    ack = await work
                if ack['taskId'] != task_id: raise ValueError('task_ack_mismatch')
                if ack['accepted']:
                    revision = ack['revision']
                    if value['type'] == 'finished': terminal = True
                    return
                if attempt == 0 and ack['revision'] > revision:
                    revision = ack['revision']; continue
                raise ValueError('task_event_denied')

        async def invoke(step):
            if task_id in self.cancelled: raise asyncio.CancelledError()
            return await self.invoke(step['capabilityId'], step['args'], task={'taskId': task_id, 'stepId': step['id']})

        async def execute():
            try:
                async with asyncio.timeout(LIMITS['timeout_seconds']):
                    await event({'type': 'planning'})
                    if task_id in self.cancelled: raise asyncio.CancelledError()
                    plan = await build_plan(task_id)
                    await event({'type': 'plan_ready', 'stepIds': [step['id'] for step in plan['steps']]})
                    return await Executor(invoke, event).run(plan)
            except (asyncio.CancelledError, TimeoutError):
                if not terminal: await event({'type': 'finished', 'status': 'cancelled'})
                return {'status': 'cancelled', 'steps': {}}
            except Exception:
                if not terminal: await event({'type': 'finished', 'status': 'failed'})
                raise
            finally:
                if not terminal and not self.closing:
                    # An event may have committed even when its ack was lost. Never replay an effect.
                    # Main reconciles its actual stored state, not this client's last known revision.
                    try: await event({'type': 'abandoned'})
                    except Exception: pass

        work = asyncio.create_task(execute())
        self.jobs[task_id] = (origin, work)
        try: return await work
        finally:
            self.jobs.pop(task_id, None)
            self.cancelled.discard(task_id)

    async def cancel(self, task_id):
        self.cancelled.add(task_id)
        entry = self.jobs.get(task_id)
        if entry is not None:
            if not entry[1].cancelling(): entry[1].cancel()
            await asyncio.gather(entry[1], return_exceptions=True)

    async def close_origin(self, origin=None):
        for task_id, (owner, _) in list(self.jobs.items()):
            if origin is None or owner == origin: await self.cancel(task_id)
