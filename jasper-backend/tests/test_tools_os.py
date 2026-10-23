import json
import subprocess
import unittest
from unittest.mock import MagicMock, patch

import tools_os


class ToolsOsProcessTests(unittest.TestCase):
    @patch.dict(
        "os.environ",
        {
            "SystemRoot": "C:\\Windows",
            "TEMP": "C:\\Temp",
            "GEMINI_API_KEY": "gemini-secret",
            "GROQ_API_KEY": "groq-secret",
            "JASPER_LICENSE_KEY": "license-secret",
        },
        clear=True,
    )
    @patch("tools_os.subprocess.Popen")
    def test_powershell_receives_minimal_environment_without_secrets(self, popen: MagicMock) -> None:
        process = popen.return_value
        process.communicate.return_value = ("ok", "")
        process.returncode = 0

        result = json.loads(tools_os.run_powershell("Write-Output ok"))

        self.assertEqual(result["status"], "ok")
        environment = popen.call_args.kwargs["env"]
        self.assertNotIn("GEMINI_API_KEY", environment)
        self.assertNotIn("GROQ_API_KEY", environment)
        self.assertNotIn("JASPER_LICENSE_KEY", environment)
        self.assertEqual(environment["SystemRoot"], "C:\\Windows")

    @patch("tools_os._terminate_process_tree")
    @patch("tools_os.subprocess.Popen")
    def test_timeout_terminates_the_entire_process_tree(
        self, popen: MagicMock, terminate_tree: MagicMock
    ) -> None:
        process = popen.return_value
        process.pid = 2468
        process.communicate.side_effect = subprocess.TimeoutExpired("powershell", 15)

        result = json.loads(tools_os.run_powershell("Start-Sleep -Seconds 60"))

        terminate_tree.assert_called_once_with(2468)
        self.assertEqual(result["status"], "error")
        self.assertIn("Timeout", result["error"])


if __name__ == "__main__":
    unittest.main()
