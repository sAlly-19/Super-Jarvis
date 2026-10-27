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
        if messages[0]['content'].startswith('Você redige a resposta final'):
            if os.getenv('JASPER_TEST_REMINDERS') == '1':
                observed = json.dumps(messages, ensure_ascii=False)
                text = 'Lembrete FIXTURE_REMINDER agendado para 2027-01-31 09:00 UTC.' if 'FIXTURE_REMINDER' in observed and '2027-01-31' in observed else 'Sem observacao de lembrete.'
                return ProviderResponse(text, [], {'role': 'assistant', 'content': text})
            text = 'O comando retornou erro (código 7). PLAN_B_NATIVE_OUTPUT; PLAN_B_NATIVE_STDERR' if os.getenv('JASPER_TEST_DIAGNOSTICS') == '1' else 'Consulta concluída com os dados observados.'
            return ProviderResponse(text, [], {'role': 'assistant', 'content': text})
        if os.getenv('JASPER_TEST_ORCHESTRATOR') == '1':
            if messages[0]['content'].startswith('Produce somente JSON'):
                steps = [
                    {'id': name, 'capabilityId': 'get_system_telemetry', 'args': {}, 'dependsOn': [] if name == 'a' else ['a'],
                     'bindings': [], 'successCriterion': {'verifierId': 'telemetry_read', 'expected': None}}
                    for name in ('a', 'b')]
                if os.getenv('JASPER_TEST_REMINDERS') == '1':
                    self.reminder_plans = getattr(self, 'reminder_plans', 0) + 1
                    steps = [
                        {'id': 'a', 'capabilityId': 'reminder_create', 'args': {'title': 'FIXTURE_REMINDER', 'description': 'Synthetic', 'schedule': {'policy': 'jasper', 'localDateTime': '2027-01-31T09:00:00', 'timeZone': 'UTC', 'recurrence': 'monthly', 'anchorDay': 31}}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'reminder_write', 'expected': None}},
                        {'id': 'b', 'capabilityId': 'reminder_get', 'args': {}, 'dependsOn': ['a'], 'bindings': [{'inputField': 'id', 'fromStepId': 'a', 'outputField': 'id'}], 'successCriterion': {'verifierId': 'reminder_read', 'expected': None}}
                    ]
                    if self.reminder_plans == 2:
                        steps = [
                            {'id': 'a', 'capabilityId': 'reminder_list', 'args': {'limit': 1}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'reminder_read', 'expected': None}},
                            {'id': 'b', 'capabilityId': 'reminder_update', 'args': {'patch': {'title': 'FIXTURE_REMINDER_UPDATED'}}, 'dependsOn': ['a'], 'bindings': [{'inputField': 'id', 'fromStepId': 'a', 'outputField': 'id'}, {'inputField': 'expectedRevision', 'fromStepId': 'a', 'outputField': 'revision'}], 'successCriterion': {'verifierId': 'reminder_write', 'expected': None}},
                            {'id': 'c', 'capabilityId': 'reminder_get', 'args': {}, 'dependsOn': ['b'], 'bindings': [{'inputField': 'id', 'fromStepId': 'b', 'outputField': 'id'}], 'successCriterion': {'verifierId': 'reminder_read', 'expected': None}}
                        ]
                    if self.reminder_plans >= 3:
                        steps = [{'id': 'a', 'capabilityId': 'reminder_list', 'args': {'limit': 100}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'reminder_read', 'expected': None}}]
                if os.getenv('JASPER_TEST_CANCEL_TASK') == '1':
                    marker = os.environ['JASPER_TEST_CANCEL_MARKER'].replace("'", "''")
                    command = f"[System.IO.File]::WriteAllText('{marker}', [string]$PID); Start-Sleep -Seconds 10"
                    steps[0].update({'capabilityId': 'run_powershell', 'args': {'command': command}, 'successCriterion': {'verifierId': 'none', 'expected': None}})
                if os.getenv('JASPER_TEST_DIAGNOSTICS') == '1':
                    steps = [{'id': 'a', 'capabilityId': 'run_powershell', 'args': {'command': "Write-Output 'PLAN_B_NATIVE_OUTPUT'; [Console]::Error.WriteLine('PLAN_B_NATIVE_STDERR'); exit 7"}, 'dependsOn': [], 'bindings': [], 'successCriterion': {'verifierId': 'none', 'expected': None}}]
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
