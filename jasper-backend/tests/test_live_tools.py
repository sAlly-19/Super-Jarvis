import asyncio
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from live_tools import _run_worker


class LiveToolsTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_waits_for_worker_process_to_exit(self):
        processes = []
        spawn = asyncio.create_subprocess_exec
        async def record_spawn(*args, **kwargs):
            process = await spawn(*args, **kwargs)
            processes.append(process)
            return process
        with patch('live_tools.asyncio.create_subprocess_exec', side_effect=record_spawn):
            task = asyncio.create_task(_run_worker([sys.executable, '-c', 'import time; time.sleep(30)'], {}))
            for _ in range(100):
                if processes:
                    break
                await asyncio.sleep(0.01)
            self.assertTrue(processes)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertIsNotNone(processes[0].returncode)

    async def test_worker_has_no_api_keys_in_environment(self):
        code = "import os,json; print(json.dumps({'leaked':os.getenv('GEMINI_API_KEY')}))"
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'never-share'}):
            result = await _run_worker([sys.executable, '-c', code], {})
        self.assertEqual(result, {'leaked': None})
