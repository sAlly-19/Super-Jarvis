"""Licensed sidecar's Gemini Live connection. No credentials leave this process."""
import asyncio
import base64
import contextlib
import json
from typing import Any

from provider_adapters import _safe_provider_error
from gemini_tools import gemini_function_declarations
from tools_os import AVAILABLE_FUNCTIONS, TOOLS_SCHEMA
from live_tools import execute_live_tool
from direct_agent import visual_tool_result

LIVE_MODEL = 'gemini-3.8-live'
LIVE_VOICES = frozenset(('Charon', 'Puck', 'Fenrir', 'Aoede', 'Kore', 'Orus', 'Leda', 'Zephyr'))


def _client(key):
    from google import genai
    return genai.Client(api_key=key)


class LiveCall:
    def __init__(self, emit, client_factory=_client, tool_executor=execute_live_tool, tool_catalog=None):
        self.emit = emit
        self.client_factory = client_factory
        self.tool_executor = tool_executor
        self.tool_catalog = tool_catalog
        self.client = None
        self.session = None
        self.context = None
        self.tasks = []
        self.tool_tasks = {}
        self.audio = asyncio.Queue(maxsize=20)
        self.active = False
        self.output_text = ''
        self.input_text = ''

    async def start(self, key: str, voice: str, system_prompt: str, greeting=False):
        if not key.strip():
            raise ValueError('Cadastre sua chave Google Gemini para usar a chamada em tempo real.')
        await self.stop()
        selected_voice = voice if voice in LIVE_VOICES else (
            'Kore' if voice in ('pt-BR-FranciscaNeural', 'pt-BR-ThalitaNeural') else 'Charon'
        )
        self.client = self.client_factory(key)
        config = {
            'response_modalities': ['AUDIO'],
            'system_instruction': system_prompt,
            'speech_config': {'voice_config': {'prebuilt_voice_config': {'voice_name': selected_voice}}},
            'input_audio_transcription': {},
            'output_audio_transcription': {},
        }
        tool_definitions = gemini_function_declarations(self.tool_catalog() if self.tool_catalog else TOOLS_SCHEMA)
        if tool_definitions:
            config['tools'] = [{'function_declarations': tool_definitions}]
        try:
            self.context = self.client.aio.live.connect(model=LIVE_MODEL, config=config)
            self.session = await asyncio.wait_for(self.context.__aenter__(), timeout=20)
            self.active = True
            self.output_text = ''
            self.input_text = ''
            self.tasks = [asyncio.create_task(self._send()), asyncio.create_task(self._receive())]
            if greeting:
                await self.session.send_client_content(
                    turns={'role': 'user', 'parts': [{'text': 'Cumprimente brevemente em português e pergunte como pode ajudar.'}]},
                    turn_complete=True,
                )
        except BaseException:
            await self.stop()
            raise

    def enqueue_audio(self, encoded: str) -> bool:
        if not self.active or len(encoded) > 65536:
            return False
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            return False
        if not data or len(data) % 2:
            return False
        if self.audio.full():
            # Keep latency bounded when the network stalls.
            self.audio.get_nowait()
        self.audio.put_nowait(data)
        return True

    async def send_text(self, text):
        if self.active:
            await self.session.send_client_content(turns={'role': 'user', 'parts': [{'text': text}]}, turn_complete=True)

    async def _send(self):
        try:
            while self.active:
                data = await self.audio.get()
                await self.session.send_realtime_input(audio={'data': data, 'mime_type': 'audio/pcm;rate=16000'})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._failed(exc)

    async def _receive(self):
        try:
            while self.active:
                received = False
                async for message in self.session.receive():
                    received = True
                    if not self.active:
                        return
                    cancellation = getattr(message, 'tool_call_cancellation', None)
                    for call_id in getattr(cancellation, 'ids', None) or []:
                        task = self.tool_tasks.get(call_id)
                        if task:
                            task.cancel()
                    content = getattr(message, 'server_content', None)
                    if content:
                        if getattr(content, 'interrupted', False):
                            self.output_text = ''
                            await self.emit('interrupted', {})
                        turn = getattr(content, 'model_turn', None)
                        for part in getattr(turn, 'parts', None) or []:
                            inline = getattr(part, 'inline_data', None)
                            if inline and inline.data and str(inline.mime_type).startswith('audio/pcm'):
                                await self.emit('audio_output', {
                                    'audio_base64': base64.b64encode(inline.data).decode(),
                                    'format': 'pcm', 'text': '',
                                })
                        input_transcript = getattr(content, 'input_transcription', None)
                        if input_transcript and input_transcript.text:
                            self.input_text += input_transcript.text
                            await self.emit('user_transcript', {'text': self.input_text})
                        output_transcript = getattr(content, 'output_transcription', None)
                        if output_transcript and output_transcript.text:
                            self.output_text += output_transcript.text
                        if getattr(content, 'turn_complete', False):
                            if self.output_text:
                                await self.emit('response', {'text': self.output_text})
                            self.output_text = ''
                            self.input_text = ''
                            await self.emit('turn_complete', {})
                    tool_call = getattr(message, 'tool_call', None)
                    for call in getattr(tool_call, 'function_calls', None) or []:
                        if call.id in self.tool_tasks or len(self.tool_tasks) >= 8:
                            continue
                        task = asyncio.create_task(self._tool(call))
                        self.tool_tasks[call.id] = task
                        task.add_done_callback(lambda _, call_id=call.id: self.tool_tasks.pop(call_id, None))
                if not received:
                    raise ConnectionError('Live connection closed')
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._failed(exc)

    async def _tool(self, call):
        try:
            fn = AVAILABLE_FUNCTIONS.get(call.name)
            args = dict(call.args or {})
            await self.emit('tool_execution', {'tool': call.name, 'args': {}})
            declared = any(tool.get('function', {}).get('name') == call.name for tool in (self.tool_catalog() if self.tool_catalog else TOOLS_SCHEMA))
            if fn or declared:
                result = await self.tool_executor(call.name, args)
                if call.name == 'capture_screen_base64' and isinstance(result, dict) and isinstance(result.get('data'), str):
                    await self.session.send_realtime_input(video={'data': base64.b64decode(result['data']), 'mime_type': 'image/jpeg'})
                    result = {**result, 'data': {'message': 'Captura enviada à sessão.'}}
                if call.name == 'capture_screen_base64' and isinstance(result, str):
                    await self.session.send_realtime_input(video={'data': base64.b64decode(result), 'mime_type': 'image/jpeg'})
                    result = {'status': 'ok', 'message': 'Captura enviada à sessão.'}
                elif isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except ValueError:
                        result = {'result': result}
            else:
                result = {'error': 'Ferramenta desconhecida.'}
            if not isinstance(result, dict):
                result = {'result': result}
        except asyncio.CancelledError:
            return
        except Exception:
            result = {'error': 'Não foi possível executar a ferramenta.'}
        if self.active:
            try:
                await self.emit('tool_result', {'tool': call.name, 'result': visual_tool_result(result)})
                await self.session.send_tool_response(function_responses=[{
                    'id': call.id, 'name': call.name, 'response': result,
                }])
            except Exception as exc:
                await self._failed(exc)

    async def _failed(self, exc):
        if self.active:
            self.active = False
            await self.emit('error', {'message': _safe_provider_error('gemini', exc, LIVE_MODEL).user_message})
            await self.stop()
            await self.emit('status', {'status': 'live_closed', 'message': 'Chamada encerrada.'})

    async def stop(self):
        self.active = False
        current = asyncio.current_task()
        tasks = [t for t in self.tasks + list(self.tool_tasks.values()) if t is not current]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.tasks = []
        self.tool_tasks.clear()
        if self.context is not None and self.session is not None:
            with contextlib.suppress(Exception):
                await self.context.__aexit__(None, None, None)
        self.context = None
        self.session = None
        if self.client is not None:
            with contextlib.suppress(Exception):
                await self.client.aio.aclose()
            with contextlib.suppress(Exception):
                self.client.close()
        self.client = None
        while not self.audio.empty():
            self.audio.get_nowait()
