import asyncio
import os
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dispatch import RuntimeDispatcher


class DispatcherTests(unittest.IsolatedAsyncioTestCase):
    async def test_replacing_chat_keeps_ack_reader_free(self):
        started, ack, cleaned = asyncio.Event(), asyncio.Event(), asyncio.Event()
        class Runtime:
            current_task = None
            live_call = None
            async def handle(self, frame):
                if frame['type'] == 'chat' and frame['id'] == 'first':
                    started.set()
                    try: await asyncio.Event().wait()
                    finally: await ack.wait(); cleaned.set()
                if frame['type'] == 'task_event_ack': ack.set()
                yield {'type': frame['type']}
        async def send(frame): pass
        dispatcher = RuntimeDispatcher(Runtime(), send)
        await dispatcher.handle({'type': 'chat', 'id': 'first'})
        await started.wait()
        await asyncio.wait_for(dispatcher.handle({'type': 'chat', 'id': 'second'}), 0.1)
        await dispatcher.handle({'type': 'task_event_ack'})
        await dispatcher.drain_controls()
        self.assertTrue(cleaned.is_set())
        await dispatcher.close()

    async def test_shutdown_detaches_task_acks_before_waiting_for_turn(self):
        from types import SimpleNamespace
        released, started = asyncio.Event(), asyncio.Event()
        class Runtime:
            current_task = None
            live_call = None
            tasks = SimpleNamespace(begin_shutdown=lambda: released.set())
            async def handle(self, frame):
                if frame['type'] == 'chat':
                    started.set()
                    try: await asyncio.Event().wait()
                    finally: await released.wait()
                yield {'type': frame['type']}
        async def send(frame): pass
        dispatcher = RuntimeDispatcher(Runtime(), send)
        await dispatcher.handle({'type': 'chat'})
        await started.wait()
        await asyncio.wait_for(dispatcher.handle({'type': 'shutdown'}), 0.1)
        self.assertTrue(released.is_set())
    async def test_call_stop_does_not_block_ack_required_for_task_cleanup(self):
        entered, acknowledged = asyncio.Event(), asyncio.Event()
        class Runtime:
            current_task = None
            live_call = None
            async def handle(self, frame):
                if frame['type'] == 'live_stop':
                    entered.set(); await acknowledged.wait()
                if frame['type'] == 'task_event_ack': acknowledged.set()
                yield {'type': frame['type']}
        async def send(frame): pass
        dispatcher = RuntimeDispatcher(Runtime(), send)
        await asyncio.wait_for(dispatcher.handle({'type': 'live_stop'}), 0.1)
        await entered.wait()
        await dispatcher.handle({'type': 'task_event_ack'})
        await dispatcher.drain_controls()
    async def test_control_frames_are_processed_while_chat_is_running(self):
        emitted = []
        started = asyncio.Event()
        cleaned = asyncio.Event()
        class Runtime:
            current_task = None
            live_call = None
            async def handle(self, frame):
                if frame['type'] == 'chat':
                    started.set()
                    try:
                        await asyncio.Event().wait()
                    finally:
                        cleaned.set()
                yield {'type': frame['type']}
        async def send(frame): emitted.append(frame)
        dispatcher = RuntimeDispatcher(Runtime(), send)
        await dispatcher.handle({'type': 'chat'})
        await started.wait()
        await dispatcher.handle({'type': 'capability_response'})
        self.assertEqual(emitted, [{'type': 'capability_response'}])
        await dispatcher.close()
        self.assertTrue(cleaned.is_set())
