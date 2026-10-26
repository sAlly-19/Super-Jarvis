"""Keep control and authorization messages responsive during an agent turn."""
import asyncio
import contextlib


class RuntimeDispatcher:
    def __init__(self, runtime, send):
        self.runtime = runtime
        self.send = send
        self.control_tail = None

    async def drain_controls(self):
        if self.control_tail is not None:
            await self.control_tail

    async def _consume(self, frame):
        try:
            async for response in self.runtime.handle(frame):
                await self.send(response)
        except asyncio.CancelledError:
            raise
        except Exception:
            await self.send({'version': 1, 'id': frame.get('id', 'dispatch-error'), 'replyTo': frame.get('id'),
                'type': 'error', 'payload': {'message': 'A solicitação não foi concluída.'}})

    async def close(self):
        task = self.runtime.current_task
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self.runtime.current_task = None

    def begin_shutdown(self):
        tasks = getattr(self.runtime, 'tasks', None)
        if tasks is not None: tasks.begin_shutdown()

    async def handle(self, frame):
        kind = frame['type']
        is_turn = kind in ('chat', 'audio_input') and not (self.runtime.live_call is not None and self.runtime.live_call.active)
        if kind in ('config', 'live_start', 'live_stop', 'memory_clear', 'task_cancel') or is_turn:
            previous = self.control_tail
            async def control():
                if previous is not None:
                    await previous
                if kind in ('config', 'live_start', 'memory_clear') or is_turn:
                    await self.close()
                if is_turn:
                    self.runtime.current_task = asyncio.create_task(self._consume(frame))
                else:
                    await self._consume(frame)
            self.control_tail = asyncio.create_task(control())
            return
        if kind == 'shutdown':
            self.begin_shutdown()
            await self.drain_controls()
            await self.close()
        await self._consume(frame)
