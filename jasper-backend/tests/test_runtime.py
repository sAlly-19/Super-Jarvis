import asyncio
import unittest
import sys
import os

# Add parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from runtime import JasperRuntime


class TestJasperRuntime(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runtime = JasperRuntime()

    async def test_hello_produces_hello_ack(self):
        msg = {
            "version": 1,
            "id": "req-1",
            "type": "hello",
            "payload": {"client": "test", "protocolVersion": 1},
        }
        replies = [reply async for reply in self.runtime.handle(msg)]
        self.assertEqual(len(replies), 1)
        ack = replies[0]
        self.assertEqual(ack["version"], 1)
        self.assertEqual(ack["type"], "hello_ack")
        self.assertEqual(ack["replyTo"], "req-1")
        self.assertEqual(ack["payload"]["protocolVersion"], 1)
        self.assertIn("tools", ack["payload"])
        self.assertIsInstance(ack["payload"]["tools"], list)

    async def test_config_updates_and_emits_status(self):
        msg = {
            "version": 1,
            "id": "req-cfg",
            "type": "config",
            "payload": {
                "agent_name": "TestBot",
                "model": "gemini/gemini-2.5-flash",
                "voice": "pt-BR-AntonioNeural",
            },
        }
        replies = [reply async for reply in self.runtime.handle(msg)]
        self.assertEqual(len(replies), 1)
        status = replies[0]
        self.assertEqual(status["type"], "status")
        self.assertEqual(status["replyTo"], "req-cfg")
        self.assertEqual(status["payload"]["status"], "connected")
        self.assertEqual(self.runtime.config["agent_name"], "TestBot")

    async def test_memory_clear_and_snapshot(self):
        # Prepopulate fact
        self.runtime.facts.append({"fact": "O usuário gosta de programar"})

        # Snapshot
        snap_msg = {"version": 1, "id": "req-snap", "type": "memory_snapshot", "payload": {}}
        replies = [r async for r in self.runtime.handle(snap_msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "memory_upsert")
        self.assertEqual(len(replies[0]["payload"]["facts"]), 1)

        # Clear
        clr_msg = {"version": 1, "id": "req-clr", "type": "memory_clear", "payload": {}}
        replies = [r async for r in self.runtime.handle(clr_msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "memory_clear")
        self.assertEqual(len(self.runtime.facts), 0)

    async def test_shutdown_emits_status(self):
        msg = {"version": 1, "id": "req-shut", "type": "shutdown", "payload": {}}
        replies = [r async for r in self.runtime.handle(msg)]
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "status")
        self.assertEqual(replies[0]["payload"]["status"], "shutting_down")
        self.assertEqual(replies[0]["replyTo"], "req-shut")


if __name__ == "__main__":
    unittest.main()
