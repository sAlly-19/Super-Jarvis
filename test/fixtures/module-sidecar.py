"""Integration-test model only; native read-only tool executes in the real worker."""
import asyncio
import os
import sys
import json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'jasper-backend'))
import runtime
from provider_adapters import ProviderResponse, ProviderToolCall


class DeterministicProvider:
    """Scripted tool choices, not a fake planner; arguments depend on real preceding tool outputs."""
    def __init__(self):
        self.turn = 0

    async def complete(self, model, messages, tools, temperature):
        from orchestration.responder import fallback_response
        user_index = max(i for i, message in enumerate(messages) if message['role'] == 'user')
        results = [message for message in messages[user_index + 1:] if message['role'] == 'tool']
        if not results:
            self.turn += 1
        count = len(results)
        catalog = {item['function']['name'] for item in tools}
        def call(name, args):
            call_id = 'direct-' + str(count)
            return ProviderResponse('', [ProviderToolCall(call_id, name, args)], {
                'role': 'assistant', 'content': '', 'tool_calls': [{'id': call_id, 'type': 'function',
                    'function': {'name': name, 'arguments': json.dumps(args)}}]})
        def finish():
            observed = {str(i): {**json.loads(item['content']), 'capabilityId': item['name']} for i, item in enumerate(results)}
            text = fallback_response({'status': 'unknown', 'results': observed})
            if os.getenv('JASPER_TEST_REMINDERS') == '1':
                encoded = json.dumps(observed)
                if 'FIXTURE_REMINDER' in encoded and '2027-01-31' in encoded:
                    text = 'Lembrete FIXTURE_REMINDER agendado para 2027-01-31 09:00 UTC.'
            return ProviderResponse(text, [], {'role': 'assistant', 'content': text})
        if not tools:
            return finish()
        if os.getenv('JASPER_TEST_EMAIL_REMINDERS') == '1' and 'reminder_create' not in catalog:
            return ProviderResponse('Modulo reminders indisponivel.', [], {'role': 'assistant', 'content': 'Modulo reminders indisponivel.'})
        previous = json.loads(results[-1]['content']) if results else {}
        data = previous.get('data', {})
        if os.getenv('JASPER_TEST_EMAIL') == '1':
            if count == 0:
                args = {'limit': 1}
                if os.getenv('JASPER_TEST_EMAIL_OUTLOOK') == '1': args['subject'] = 'OUTLOOK_FIXTURE'
                return call('email_search', args)
            if count == 1: return call('email_read', {'ref': data['firstRef']})
            if count == 2: return call('email_reply', {'ref': data['ref'], 'expectedVersion': data['version'],
                'text': 'Synthetic reply authorized by the user.', 'attachmentHandles': []})
            if count == 3 and os.getenv('JASPER_TEST_EMAIL_REMINDERS') == '1':
                return call('reminder_create', {'title': 'Synthetic email follow-up', 'description': 'Explicitly requested by the user.',
                    'schedule': {'policy': 'jasper', 'localDateTime': '2026-10-29T09:00:00', 'timeZone': 'UTC', 'recurrence': 'none', 'anchorDay': 29}})
            return finish()
        if os.getenv('JASPER_TEST_REMINDERS') == '1':
            if self.turn == 1:
                if count == 0: return call('reminder_create', {'title': 'FIXTURE_REMINDER', 'description': 'Synthetic',
                    'schedule': {'policy': 'jasper', 'localDateTime': '2027-01-31T09:00:00', 'timeZone': 'UTC', 'recurrence': 'monthly', 'anchorDay': 31}})
                if count == 1: return call('reminder_get', {'id': data['id']})
            elif self.turn == 2:
                if count == 0: return call('reminder_list', {'limit': 1})
                if count == 1: return call('reminder_update', {'id': data['id'], 'expectedRevision': data['revision'], 'patch': {'title': 'FIXTURE_REMINDER_UPDATED'}})
                if count == 2: return call('reminder_get', {'id': data['id']})
            elif count == 0: return call('reminder_list', {'limit': 100})
            return finish()
        if os.getenv('JASPER_TEST_CANCEL_TASK') == '1':
            if count: return finish()
            marker = os.environ['JASPER_TEST_CANCEL_MARKER'].replace("'", "''")
            return call('run_powershell', {'command': f"[System.IO.File]::WriteAllText('{marker}', [string]$PID); Start-Sleep -Seconds 10"})
        if os.getenv('JASPER_TEST_DIAGNOSTICS') == '1':
            if count: return finish()
            return call('run_powershell', {'command': "Write-Output 'PLAN_B_NATIVE_OUTPUT'; [Console]::Error.WriteLine('PLAN_B_NATIVE_STDERR'); exit 7"})
        limit = 2 if os.getenv('JASPER_TEST_ORCHESTRATOR') == '1' else 1
        if count < limit:
            return call('pc_health_read' if os.getenv('JASPER_TEST_HEALTH') == '1' else 'get_system_telemetry', {})
        return finish()

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
