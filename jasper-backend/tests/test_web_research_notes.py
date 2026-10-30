import unittest
import asyncio
import time
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from web_research_notes import ResearchNotes, validate_note

RID = '11111111-1111-4111-8111-111111111111'
def result(ticket='a' * 64):
    return {'status': 'succeeded', 'data': {'kind': 'search', 'researchId': RID, 'outcome': {'state': 'ok'},
            '_historyReceipt': {'researchId': RID, 'ticket': ticket, 'sessionId': 2, 'expiresAt': time.time() * 1000 + 300000}}}

class NotesTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_runtime_strips_receipt_before_model_and_emits_summary(self):
        from runtime import JasperRuntime
        from provider_adapters import ProviderResponse, ProviderToolCall
        from unittest.mock import AsyncMock, patch
        emitted = []
        async def emit(frame): emitted.append(frame)
        runtime = JasperRuntime(emit)
        runtime.config.update({'provider': 'ollama', 'model': 'ollama/qwen2.5:3b', 'api_key': ''})
        runtime.module_bridge.session_id = 2
        runtime.module_bridge.invoke = AsyncMock(return_value=result())
        runtime.module_bridge.tools = lambda: []
        runtime.provider_adapter = AsyncMock()
        runtime.provider_adapter.complete.side_effect = [
            ProviderResponse(content='', tool_calls=[ProviderToolCall(id='call', name='web_search', arguments={'query': 'Question'})], assistant_message={'role': 'assistant', 'content': ''}),
            ProviderResponse(content='Answer', tool_calls=[], assistant_message={'role': 'assistant', 'content': 'Answer'})]
        with patch('runtime.generate_tts_base64', new_callable=AsyncMock, return_value=''):
            replies = [r async for r in runtime._run_agent_turn('one', 'Question')]
        self.assertNotIn('a' * 64, str(runtime.provider_adapter.complete.call_args_list))
        self.assertNotIn('a' * 64, str(runtime.history))
        self.assertNotIn('a' * 64, str(replies))
        self.assertEqual([e['payload']['summary'] for e in emitted if e['type'] == 'web_research_note'], ['Answer'])

    async def test_receipt_is_private_and_turns_are_independent(self):
        emitted = []
        async def emit(frame): emitted.append(frame)
        notes = ResearchNotes(emit, lambda: 2)
        notes.begin('one'); notes.begin('two')
        source = result()
        clean = notes.consume('one', source)
        self.assertNotIn('_historyReceipt', clean['data'])
        self.assertIn('_historyReceipt', source['data'])
        notes.consume('two', result('b' * 64))
        await notes.finish('two', 'Second')
        await notes.finish('one', 'First')
        self.assertEqual([x['payload']['summary'] for x in emitted], ['Second', 'First'])
        self.assertEqual([x['payload']['ticket'] for x in emitted], ['b' * 64, 'a' * 64])
        await notes.finish('one', 'Duplicate')
        self.assertEqual(len(emitted), 2)

    async def test_late_results_cannot_reopen_discarded_or_closed_turns(self):
        emitted = []
        async def emit(frame): emitted.append(frame)
        notes = ResearchNotes(emit, lambda: 2)
        notes.begin('one'); notes.discard('one')
        self.assertNotIn('_historyReceipt', notes.consume('one', result())['data'])
        await notes.finish('one', 'Stale')
        notes.begin('two'); notes.consume('two', result()); notes.close()
        await notes.finish('two', 'Stale')
        self.assertEqual(emitted, [])

    async def test_exact_protocol_and_emission_errors_do_not_break_response(self):
        note = {'researchId': RID, 'ticket': 'a' * 64, 'sessionId': 2, 'summary': 'Text'}
        validate_note(note)
        for change in [{'extra': 1}, {'sessionId': 2.0}, {'summary': 'x' * 4001}, {'ticket': 'bad'}]:
            with self.assertRaises(ValueError): validate_note({**note, **change})
        async def broken(_frame): raise RuntimeError('synthetic')
        notes = ResearchNotes(broken, lambda: 2); notes.begin('one')
        notes.consume('one', result()); await notes.finish('one', 'Response')
        await notes.finish('one', 'No retry')

if __name__ == '__main__': unittest.main()
