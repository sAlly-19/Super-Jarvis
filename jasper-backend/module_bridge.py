"""Private modular protocol client. Only the Main process can authorize dispatch."""
import asyncio
import uuid
from live_tools import execute_live_tool


class ModuleBridge:
    @staticmethod
    def _cancel_worker(task):
        # A second cancel would interrupt finally while taskkill/process.wait is still running.
        if not task.done() and not task.cancelling(): task.cancel()

    def __init__(self, emit, executor=execute_live_tool):
        self.emit = emit
        self.executor = executor
        self.version = -1
        self.session_id = None
        self.capabilities = {}
        self.pending = {}
        self.executing = {}
        self.granted = {}

    def tools(self):
        return [{'type': 'function', 'function': {'name': item['id'], 'description': item['description'], 'parameters': item['inputSchema']}}
                for item in self.capabilities.values()]

    async def _send(self, kind, payload, reply_to=None):
        if self.emit is None:
            raise RuntimeError('module_channel_unavailable')
        frame = {'version': 1, 'id': str(uuid.uuid4()), 'type': kind, 'payload': payload}
        if reply_to:
            frame['replyTo'] = reply_to
        await self.emit(frame)

    async def snapshot(self, payload, reply_to):
        if payload['moduleRuntimeVersion'] != 1 or payload['snapshotVersion'] <= self.version:
            raise ValueError('invalid_module_snapshot')
        for future in self.pending.values():
            if not future.done():
                future.set_result({'error': 'module_snapshot_changed'})
        for task in self.executing.values():
            self._cancel_worker(task)
        self.capabilities = {item['id']: item for item in payload['capabilities']}
        self.version = payload['snapshotVersion']
        self.session_id = payload['sessionId']
        await self._send('module_snapshot_ack', {'moduleRuntimeVersion': 1, 'snapshotVersion': self.version}, reply_to)

    async def invoke(self, capability_id, args, task=None):
        if capability_id not in self.capabilities or self.emit is None:
            return {'error': 'module_unavailable'}
        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            payload = {'requestId': request_id, 'snapshotVersion': self.version, 'capabilityId': capability_id, 'args': args}
            if task is not None: payload['task'] = task
            await self._send('capability_request', payload)
            return await asyncio.wait_for(future, timeout=35)
        except asyncio.TimeoutError:
            return {'error': 'module_request_timeout'}
        except asyncio.CancelledError:
            await self._send('capability_cancel_request', {'requestId': request_id})
            worker = self.executing.get(self.granted.get(request_id))
            if worker is not None:
                self._cancel_worker(worker)
                while not worker.done():
                    try: await asyncio.shield(worker)
                    except asyncio.CancelledError: continue
            raise
        finally:
            self.pending.pop(request_id, None)
            self.granted.pop(request_id, None)

    def respond(self, payload):
        future = self.pending.get(payload['requestId'])
        if future is None or future.done():
            return
        result = payload['result']
        # Raw data can be used by the LLM; it must not be described as verified by the bridge.
        future.set_result(result)

    async def execute(self, payload, reply_to=None):
        context = payload['context']
        invocation_id = context['invocationId']
        if (payload['snapshotVersion'] != self.version or context['sessionId'] != self.session_id
                or payload['capabilityId'] not in self.capabilities or invocation_id in self.executing
                or payload['requestId'] not in self.pending or payload['requestId'] in self.granted):
            return
        self.granted[payload['requestId']] = invocation_id
        async def work():
            try:
                value = await self.executor(payload['capabilityId'], payload['args'])
                result = {'status': 'unknown', 'data': value, 'evidence': [], 'errorCode': 'verification_unavailable'}
            except asyncio.CancelledError:
                result = {'status': 'unknown', 'evidence': [], 'errorCode': 'execution_cancelled'}
            except Exception:
                result = {'status': 'unknown', 'evidence': [], 'errorCode': 'execution_failed'}
            await self._send('capability_result', {'context': context, 'result': result}, reply_to)
        task = asyncio.create_task(work())
        self.executing[invocation_id] = task
        task.add_done_callback(lambda done: self.executing.pop(invocation_id, None))

    async def cancel(self, invocation_id):
        task = self.executing.get(invocation_id)
        if task is not None:
            self._cancel_worker(task)

    async def close(self):
        self.capabilities = {}
        tasks = list(self.executing.values())
        for task in tasks:
            self._cancel_worker(task)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for future in self.pending.values():
            if not future.done():
                future.set_result({'error': 'module_channel_closed'})
