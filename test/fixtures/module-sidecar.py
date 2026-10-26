"""Integration-test model only; native read-only tool executes in the real worker."""
import asyncio
import os
import sys
import json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'jasper-backend'))
import runtime
from provider_adapters import ProviderResponse, ProviderToolCall


class DeterministicProvider:
    def __init__(self): self.calls = 0
    async def complete(self, model, messages, tools, temperature):
        self.calls += 1
        if os.getenv('JASPER_TEST_ORCHESTRATOR') == '1':
            if messages[0]['content'].startswith('Produce somente JSON'):
                steps = [
                    {'id': name, 'capabilityId': 'get_system_telemetry', 'args': {}, 'dependsOn': [] if name == 'a' else ['a'],
                     'bindings': [], 'successCriterion': {'verifierId': 'telemetry_read', 'expected': None}}
                    for name in ('a', 'b')]
                if os.getenv('JASPER_TEST_CANCEL_TASK') == '1':
                    marker = os.environ['JASPER_TEST_CANCEL_MARKER'].replace("'", "''")
                    command = f"[System.IO.File]::WriteAllText('{marker}', [string]$PID); Start-Sleep -Seconds 10"
                    steps[0].update({'capabilityId': 'run_powershell', 'args': {'command': command}, 'successCriterion': {'verifierId': 'none', 'expected': None}})
                return ProviderResponse(json.dumps({'steps': steps}), [], {'role': 'assistant', 'content': ''})
            return ProviderResponse('', [ProviderToolCall('read-only', 'get_system_telemetry', {})], {'role': 'assistant', 'content': ''})
        if self.calls % 2:
            return ProviderResponse('', [ProviderToolCall('read-only', 'get_system_telemetry', {})], {'role': 'assistant', 'content': ''})
        return ProviderResponse('Fim do teste.', [], {'role': 'assistant', 'content': 'Fim do teste.'})
    async def aclose(self): pass


original_init = runtime.JasperRuntime.__init__
def initialize(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    self.config.update({'provider': 'ollama', 'model': 'ollama/qwen2.5:3b', 'api_key': '', 'vision_enabled': False})
    self.provider_adapter = DeterministicProvider()
runtime.JasperRuntime.__init__ = initialize
async def silent_tts(*args, **kwargs): return ''
runtime.generate_tts_base64 = silent_tts

from main import main
sys.exit(asyncio.run(main()))
