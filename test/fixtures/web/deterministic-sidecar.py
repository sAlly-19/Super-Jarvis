"""Synthetic provider only; real protocol, runtime, bridge and note handling."""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'jasper-backend'))
import runtime
from provider_adapters import ProviderResponse, ProviderToolCall

class Provider:
    research_id = None
    async def complete(self, model, messages, tools, temperature):
        if '_historyReceipt' in json.dumps(messages): raise AssertionError('receipt_reached_model')
        user_index = max(i for i, message in enumerate(messages) if message['role'] == 'user')
        results = [message for message in messages[user_index + 1:] if message['role'] == 'tool']
        count = len(results)
        def call(name, args):
            identifier = 'web-' + str(count)
            return ProviderResponse('', [ProviderToolCall(identifier, name, args)], {'role': 'assistant', 'content': '',
                'tool_calls': [{'id': identifier, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]})
        if 'history' in messages[user_index]['content']:
            if not count: return call('web_history_get', {'id': self.research_id})
            text = 'Recovered historical research, not a new consultation.'
        else:
            if count == 0: return call('web_search', {'query': 'Synthetic public question'})
            if count == 1:
                data = json.loads(results[0]['content'])['data']
                self.research_id = data['researchId']
                return call('web_read', {'url': data['outcome']['results'][0]['url'], 'researchId': self.research_id})
            page = json.loads(results[1]['content'])['data']['outcome']['page']
            if page['publishedAt'] != '2024-01-01' or page['fetchedAt'].startswith('2024'): raise AssertionError('source_date_confused')
            text = 'Synthetic answer from an older article, consulted now: https://example.org/article'
        return ProviderResponse(text, [], {'role': 'assistant', 'content': text})
    async def aclose(self): pass

original_init = runtime.JasperRuntime.__init__
def initialize(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    self.config.update({'provider': 'ollama', 'model': 'ollama/qwen2.5:3b', 'api_key': '', 'vision_enabled': False})
    self.provider_adapter = Provider()
runtime.JasperRuntime.__init__ = initialize
async def silent_tts(*args, **kwargs): return ''
runtime.generate_tts_base64 = silent_tts
from main import main
sys.exit(asyncio.run(main()))
