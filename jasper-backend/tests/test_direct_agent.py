import asyncio
import copy
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from runtime import JasperRuntime
from provider_adapters import ProviderResponse, ProviderToolCall


def answer(text):
    return ProviderResponse(text, [], {'role': 'assistant', 'content': text})


def tool(name, args, call_id):
    return ProviderResponse('', [ProviderToolCall(call_id, name, args)], {
        'role': 'assistant', 'content': '', 'tool_calls': [{'id': call_id, 'type': 'function',
        'function': {'name': name, 'arguments': json.dumps(args)}}]})


class Adapter:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def complete(self, model, messages, tools, temperature):
        self.calls.append(copy.deepcopy({'messages': messages, 'tools': tools}))
        return self.responses.pop(0)


class DirectAgentTests(unittest.IsolatedAsyncioTestCase):
    def runtime(self, responses):
        runtime = JasperRuntime()
        runtime.update_config({'provider': 'ollama', 'model': 'ollama/qwen2.5:3b', 'apiKey': ''})
        runtime.tasks.configure(7)
        runtime.tasks.run = AsyncMock(side_effect=AssertionError('Planner must not run'))
        runtime.provider_adapter = Adapter(responses)
        runtime.module_bridge.invoke = AsyncMock(return_value={'status': 'succeeded', 'data': {'version': 'v1'}, 'evidence': []})
        return runtime

    async def chat(self, runtime):
        with patch('runtime.generate_tts_base64', new_callable=AsyncMock, return_value=''):
            return [event async for event in runtime.handle({'version': 1, 'id': 'chat', 'type': 'chat', 'payload': {'text': 'Continue'}})]

    async def test_negotiated_runtime_keeps_original_tools_and_context_across_steps(self):
        runtime = self.runtime([tool('email_read', {'ref': {'accountId': 'a', 'messageId': 'm'}}, 'c1'),
                                tool('email_reply', {'expectedVersion': 'v1'}, 'c2'), answer('Resposta aceita.')])
        runtime.history = [{'role': 'user', 'content': 'Use a conta de trabalho'}, {'role': 'assistant', 'content': 'Certo'}]
        events = await self.chat(runtime)
        self.assertEqual(runtime.module_bridge.invoke.await_count, 2)
        runtime.tasks.run.assert_not_awaited()
        self.assertEqual(runtime.module_bridge.invoke.await_args_list[1].args, ('email_reply', {'expectedVersion': 'v1'}))
        messages = runtime.provider_adapter.calls[2]['messages']
        self.assertIn('Use a conta de trabalho', json.dumps(messages))
        self.assertEqual([item['tool_call_id'] for item in messages if item['role'] == 'tool'], ['c1', 'c2'])
        self.assertEqual(next(e['payload']['text'] for e in events if e['type'] == 'response'), 'Resposta aceita.')
        self.assertFalse(any('tool_calls' in item for item in runtime.history))

    async def test_five_round_limit_never_executes_synthesis_tool_calls_or_claims_success(self):
        runtime = self.runtime([tool('test_tool', {}, f'c{i}') for i in range(6)])
        events = await self.chat(runtime)
        self.assertEqual(runtime.module_bridge.invoke.await_count, 5)
        self.assertEqual(runtime.provider_adapter.calls[-1]['tools'], [])
        text = next(e['payload']['text'] for e in events if e['type'] == 'response')
        self.assertNotEqual(text, 'Ação concluída.')
        self.assertTrue(text.strip())

    async def test_live_catalog_and_dispatch_skip_tasks_and_reject_old_execute_task(self):
        runtime = self.runtime([])
        runtime.module_bridge.capabilities = {'email_read': {'id': 'email_read', 'description': 'Read', 'inputSchema': {'type': 'object'}}}
        self.assertEqual([t['function']['name'] for t in runtime.live_task_tools()], ['email_read'])
        await runtime.invoke_live_task('email_read', {'ref': 'test'})
        runtime.module_bridge.invoke.assert_awaited_once_with('email_read', {'ref': 'test'})
        result = await runtime.invoke_live_task('execute_task', {'objective': 'old call'})
        self.assertEqual(result['errorCode'], 'module_unavailable')
        self.assertEqual(runtime.module_bridge.invoke.await_count, 1)
        runtime.tasks.run.assert_not_awaited()

    async def test_private_tool_payloads_reach_model_but_not_renderer_events(self):
        runtime = self.runtime([tool('email_read', {'private': 'private-argument'}, 'c1'), answer('Resumo solicitado.')])
        runtime.module_bridge.invoke.return_value = {'status': 'succeeded', 'data': {'body': 'private-email-body'}, 'evidence': []}
        events = await self.chat(runtime)
        tool_events = [e for e in events if e['type'] in ('tool_execution', 'tool_result')]
        self.assertNotIn('private-argument', json.dumps(tool_events))
        self.assertNotIn('private-email-body', json.dumps(tool_events))
        self.assertIn('private-email-body', json.dumps(runtime.provider_adapter.calls[1]['messages']))

    async def test_cancel_direct_live_propagates_to_bridge(self):
        runtime = self.runtime([])
        started, cleaned = asyncio.Event(), asyncio.Event()
        async def invoke(*args):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaned.set()
        runtime.module_bridge.invoke = invoke
        work = asyncio.create_task(runtime.invoke_live_task('email_read', {}))
        try:
            await asyncio.wait_for(started.wait(), 0.5)
        except TimeoutError:
            await work
            raise
        work.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await work
        self.assertTrue(cleaned.is_set())

    async def test_uncertain_email_does_not_dispatch_another_mutation_in_same_turn(self):
        runtime = self.runtime([tool('email_send', {'draftRef': 'd', 'expectedVersion': 'v'}, 'c1'),
                                tool('email_send', {'draftRef': 'd', 'expectedVersion': 'v'}, 'c2'),
                                tool('email_reconcile', {'operationId': 'op'}, 'c3'), answer('Envio incerto.')])
        runtime.module_bridge.invoke.return_value = {'status': 'unknown', 'data': {'kind': 'write', 'operation': {'state': 'unknown', 'id': 'op'}}, 'evidence': []}
        await self.chat(runtime)
        self.assertEqual([call.args[0] for call in runtime.module_bridge.invoke.await_args_list], ['email_send', 'email_reconcile'])
        self.assertIn('email_reconciliation_required', json.dumps(runtime.provider_adapter.calls[2]['messages']))

    async def test_live_serializes_calls_before_checking_uncertain_email_guard(self):
        runtime = self.runtime([])
        async def uncertain(*args):
            await asyncio.sleep(0.01)
            return {'status': 'unknown', 'evidence': [], 'errorCode': 'execution_timeout'}
        runtime.module_bridge.invoke.side_effect = uncertain
        results = await asyncio.gather(runtime.invoke_live_task('email_send', {}), runtime.invoke_live_task('email_send', {}))
        self.assertEqual(runtime.module_bridge.invoke.await_count, 1)
        self.assertEqual(results[1]['errorCode'], 'email_reconciliation_required')

    async def test_capture_bytes_do_not_enter_text_transcript_or_events(self):
        runtime = self.runtime([tool('capture_screen_base64', {}, 'c1'), answer('Captura solicitada.')])
        runtime.module_bridge.invoke.return_value = {'status': 'unknown', 'data': 'private-capture-bytes', 'evidence': []}
        events = await self.chat(runtime)
        self.assertNotIn('private-capture-bytes', json.dumps(events))
        self.assertNotIn('private-capture-bytes', json.dumps(runtime.provider_adapter.calls))
