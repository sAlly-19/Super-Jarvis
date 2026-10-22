import asyncio
import base64
import io
import json
import os
import re
from typing import Any, Dict, List, Optional

import edge_tts
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from tools_os import (
    AVAILABLE_FUNCTIONS,
    TOOLS_SCHEMA,
    capture_screen_base64,
    get_system_telemetry,
)

load_dotenv()

_litellm_mod: Any = None


def _get_litellm() -> Any:
    global _litellm_mod
    if _litellm_mod is None:
        import litellm as _ll

        _ll.drop_params = True
        _ll.suppress_debug_info = True
        _litellm_mod = _ll
    return _litellm_mod


app = FastAPI(title="Jasper Local Agent Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "app://."],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Voice mapping from legacy/UI names to Edge-TTS Neural voices
VOICE_MAP: Dict[str, str] = {
    "pt-BR-AntonioNeural": "pt-BR-AntonioNeural",
    "pt-BR-FranciscaNeural": "pt-BR-FranciscaNeural",
    "pt-BR-ThalitaNeural": "pt-BR-ThalitaNeural",
    "Charon": "pt-BR-AntonioNeural",
    "Fenrir": "pt-BR-AntonioNeural",
    "Orus": "pt-BR-AntonioNeural",
    "Puck": "pt-BR-AntonioNeural",
    "Aoede": "pt-BR-FranciscaNeural",
    "Kore": "pt-BR-FranciscaNeural",
    "Leda": "pt-BR-ThalitaNeural",
    "Zephyr": "pt-BR-ThalitaNeural",
}

VISION_KEYWORDS_RE = re.compile(
    r"\b(olhe a tela|olha a tela|veja a tela|analise a tela|o que est[áa] na tela|"
    r"o que tem na tela|leia a tela|minha tela|print da tela|captura de tela|screenshot)\b",
    re.IGNORECASE,
)


def normalize_model_name(raw_model: Optional[str]) -> str:
    """
    Normalizes UI or .env model identifiers to LiteLLM provider/model format:
    - ollama/qwen2.5:3b
    - gemini/gemini-2.5-flash
    - groq/llama-3.3-70b-versatile
    """
    model = (raw_model or os.getenv("JASPER_MODEL") or "gemini/gemini-2.5-flash").strip()
    if not model:
        return "gemini/gemini-2.5-flash"

    # Legacy Gemini Live model names from previous config
    if "live" in model.lower() or "native-audio" in model.lower():
        return "gemini/gemini-2.5-flash"

    if "/" in model:
        return model

    lower = model.lower()
    if lower.startswith("gemini"):
        return f"gemini/{model}"
    if lower.startswith("llama") or lower.startswith("mixtral") or lower.startswith("gemma"):
        return f"groq/{model}"
    if lower.startswith("qwen") or lower.startswith("phi") or lower.startswith("mistral"):
        return f"ollama/{model}"
    return model


def resolve_voice_name(raw_voice: Optional[str]) -> str:
    voice = (raw_voice or os.getenv("JASPER_VOICE") or "pt-BR-AntonioNeural").strip()
    return VOICE_MAP.get(voice, voice if "Neural" in voice else "pt-BR-AntonioNeural")


def clean_text_for_speech(text: str) -> str:
    """Removes markdown formatting and code blocks so Edge-TTS reads naturally."""
    cleaned = re.sub(r"```[\s\S]*?```", " código exibido na tela. ", text or "")
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"[*_#~>|]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


async def generate_tts_base64(text: str, voice: str = "pt-BR-AntonioNeural") -> str:
    """
    Generates neural speech audio in memory using edge-tts (zero disk I/O)
    and returns the MP3 audio encoded in base64.
    """
    spoken_text = clean_text_for_speech(text)
    if not spoken_text:
        return ""

    resolved_voice = resolve_voice_name(voice)
    communicate = edge_tts.Communicate(spoken_text, resolved_voice)
    audio_buffer = io.BytesIO()

    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            audio_buffer.write(chunk["data"])

    raw_bytes = audio_buffer.getvalue()
    if not raw_bytes:
        return ""
    return base64.b64encode(raw_bytes).decode("utf-8")


def _transcribe_wav_sync(wav_bytes: bytes, api_key: str = "") -> str:
    """
    Transcribes 16kHz WAV audio in memory using:
    1. Groq Whisper (whisper-large-v3-turbo) if a Groq key (gsk_...) is active
    2. SpeechRecognition (Google free PT-BR STT in memory, zero RAM/CPU)
    """
    groq_key = api_key if api_key.startswith("gsk_") else os.getenv("GROQ_API_KEY", "")
    if groq_key:
        try:
            ll = _get_litellm()
            file_tuple = ("speech.wav", io.BytesIO(wav_bytes), "audio/wav")
            resp = ll.transcription(
                model="groq/whisper-large-v3-turbo",
                file=file_tuple,
                language="pt",
                api_key=groq_key,
            )
            text = getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "")
            if text and str(text).strip():
                return str(text).strip()
        except Exception as exc:
            print(f"[STT] Groq Whisper fallback para SpeechRecognition: {exc}")

    try:
        import speech_recognition as sr

        recognizer = sr.Recognizer()
        with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
            audio_data = recognizer.record(source)
        text = recognizer.recognize_google(audio_data, language="pt-BR")
        return (text or "").strip()
    except Exception as exc:
        print(f"[STT] Falha ao transcrever áudio: {exc}")
        return ""


async def transcribe_audio_base64(audio_b64: str, api_key: str = "") -> str:
    try:
        wav_bytes = base64.b64decode(audio_b64)
        return await asyncio.to_thread(_transcribe_wav_sync, wav_bytes, api_key)
    except Exception as exc:
        print(f"[STT] Erro no decode base64: {exc}")
        return ""


GLOBAL_CONFIG: Dict[str, Any] = {
    "agent_name": os.getenv("JASPER_AGENT_NAME", "Jasper"),
    "model": normalize_model_name(os.getenv("JASPER_MODEL", "gemini/gemini-2.5-flash")),
    "api_key": (
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or os.getenv("GROQ_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    ),
    "voice": resolve_voice_name(os.getenv("JASPER_VOICE", "pt-BR-AntonioNeural")),
    "vision_enabled": False,
}
GLOBAL_FACTS: List[Dict[str, str]] = []
ACTIVE_SESSIONS: List["JasperSession"] = []


class JasperSession:
    def __init__(self) -> None:
        self.agent_name: str = str(GLOBAL_CONFIG["agent_name"])
        self.model: str = normalize_model_name(str(GLOBAL_CONFIG["model"]))
        self.api_key: str = str(GLOBAL_CONFIG["api_key"])
        self.voice: str = resolve_voice_name(str(GLOBAL_CONFIG["voice"]))
        self.vision_enabled: bool = bool(GLOBAL_CONFIG["vision_enabled"])
        self.history: List[Dict[str, Any]] = []
        self.facts: List[Dict[str, str]] = GLOBAL_FACTS
        self.current_task: Optional[asyncio.Task[Any]] = None

    def build_system_prompt(self) -> str:
        facts_block = ""
        if self.facts:
            facts_lines = "\n".join(f"- {f['fact']}" for f in self.facts[-20:])
            facts_block = f"\n\nFatos memorizados sobre o usuário:\n{facts_lines}"

        return (
            f"Você é {self.agent_name}, um assistente de IA Sci-Fi avançado, altamente capaz, "
            "direto, elegante e proativo integrado ao Windows.\n"
            "Responda sempre em Português do Brasil (pt-BR) de forma concisa e natural para ser "
            "falada em voz alta (evite listas longas ou blocos extensos de markdown quando não solicitados).\n"
            "Você possui Super-Ferramentas nativas do Windows (run_powershell, get_system_telemetry, "
            "gui_action, control_system_volume, capture_screen_base64). Use-as autonomamente sempre que "
            "o usuário pedir para abrir programas, executar comandos, verificar hardware/processos, "
            "interagir com a tela ou ajustar o sistema."
            f"{facts_block}"
        )

    def update_config(self, data: Dict[str, Any]) -> None:
        if data.get("agent_name") or data.get("agentName"):
            self.agent_name = str(data.get("agent_name") or data.get("agentName")).strip()
            GLOBAL_CONFIG["agent_name"] = self.agent_name
        if data.get("model"):
            self.model = normalize_model_name(str(data["model"]))
            GLOBAL_CONFIG["model"] = self.model
        if "api_key" in data or "apiKey" in data:
            new_key = str(data.get("api_key") or data.get("apiKey") or "").strip()
            if "..." not in new_key:
                self.api_key = new_key
                GLOBAL_CONFIG["api_key"] = new_key
                if new_key.startswith("gsk_"):
                    os.environ["GROQ_API_KEY"] = new_key
                elif new_key:
                    os.environ["GEMINI_API_KEY"] = new_key
                    os.environ["GOOGLE_API_KEY"] = new_key
        if data.get("voice") or data.get("voiceName"):
            self.voice = resolve_voice_name(str(data.get("voice") or data.get("voiceName")))
            GLOBAL_CONFIG["voice"] = self.voice
        if "vision" in data or "enableScreenAwareness" in data:
            val = data.get("vision") if "vision" in data else data.get("enableScreenAwareness")
            if isinstance(val, bool):
                self.vision_enabled = val
                GLOBAL_CONFIG["vision_enabled"] = val

    def clear_memory(self) -> None:
        self.history.clear()
        self.facts.clear()

    def maybe_memorize_fact(self, user_text: str) -> None:
        lower = user_text.lower()
        triggers = ("meu nome é", "eu gosto de", "prefiro ", "trabalho com", "lembre que", "memorize que")
        if any(t in lower for t in triggers):
            clean_fact = user_text.strip()
            if clean_fact and not any(f["fact"] == clean_fact for f in self.facts):
                self.facts.append({"fact": clean_fact})


async def run_agent_loop(
    websocket: WebSocket,
    session: JasperSession,
    user_text: str,
    force_vision: bool = False,
) -> str:
    """
    Autonomous Tool-Calling Loop (up to 5 chained iterations per request).
    Automatically attaches screen capture when vision is requested/enabled,
    streams real-time tool_execution events to the HUD, and returns the final answer.
    """
    session.maybe_memorize_fact(user_text)

    needs_vision = force_vision or session.vision_enabled or bool(VISION_KEYWORDS_RE.search(user_text))
    user_message_content: Any = user_text

    if needs_vision and not session.model.startswith("ollama/"):
        try:
            await websocket.send_json(
                {"type": "tool_execution", "tool": "capture_screen_base64", "args": {"auto_vision": True}}
            )
            screen_b64 = await asyncio.to_thread(capture_screen_base64)
            user_message_content = [
                {"type": "text", "text": user_text},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{screen_b64}"},
                },
            ]
        except Exception as exc:
            print(f"[AgentLoop] Falha ao anexar captura de tela automática: {exc}")

    session.history.append({"role": "user", "content": user_message_content})
    # Keep conversation context compact for low latency
    if len(session.history) > 16:
        session.history = session.history[-16:]

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": session.build_system_prompt()},
        *session.history,
    ]

    max_iterations = 5
    final_text = ""

    for _iteration in range(max_iterations):
        completion_kwargs: Dict[str, Any] = {
            "model": session.model,
            "messages": messages,
            "tools": TOOLS_SCHEMA,
            "tool_choice": "auto",
            "temperature": 0.4,
        }

        if session.model.startswith("ollama/"):
            completion_kwargs["api_base"] = os.getenv("OLLAMA_API_BASE", "http://127.0.0.1:11434")
        elif session.api_key:
            completion_kwargs["api_key"] = session.api_key

        ll = await asyncio.to_thread(_get_litellm)
        response = await ll.acompletion(**completion_kwargs)
        choice_msg = response.choices[0].message
        tool_calls = getattr(choice_msg, "tool_calls", None)

        if not tool_calls:
            final_text = (getattr(choice_msg, "content", None) or "").strip()
            break

        # Append assistant tool call request to messages
        assistant_msg_dict: Dict[str, Any] = {
            "role": "assistant",
            "content": getattr(choice_msg, "content", None) or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in tool_calls
            ],
        }
        messages.append(assistant_msg_dict)

        for tc in tool_calls:
            fn_name = tc.function.name
            raw_args = tc.function.arguments or "{}"
            try:
                fn_args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            except Exception:
                fn_args = {}

            # Emit real-time tool execution event to the Sci-Fi HUD
            await websocket.send_json(
                {
                    "type": "tool_execution",
                    "tool": fn_name,
                    "args": fn_args,
                }
            )

            fn_to_call = AVAILABLE_FUNCTIONS.get(fn_name)
            if not fn_to_call:
                tool_result = json.dumps(
                    {"status": "error", "error": f"Ferramenta '{fn_name}' não encontrada."},
                    ensure_ascii=False,
                )
            elif fn_name == "capture_screen_base64":
                try:
                    img_b64 = await asyncio.to_thread(capture_screen_base64)
                    tool_result = json.dumps(
                        {
                            "status": "ok",
                            "info": "Captura de tela 1280x720 realizada com sucesso.",
                            "size_kb": round(len(img_b64) * 3 / 4 / 1024, 1),
                        },
                        ensure_ascii=False,
                    )
                except Exception as exc:
                    tool_result = json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)
            else:
                try:
                    tool_result = await asyncio.to_thread(fn_to_call, **fn_args)
                except Exception as exc:
                    tool_result = json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": fn_name,
                    "content": str(tool_result),
                }
            )

    if not final_text:
        # Final synthesis call without tools if all 5 iterations were tool calls
        completion_kwargs = {
            "model": session.model,
            "messages": messages,
            "temperature": 0.4,
        }
        if session.model.startswith("ollama/"):
            completion_kwargs["api_base"] = os.getenv("OLLAMA_API_BASE", "http://127.0.0.1:11434")
        elif session.api_key:
            completion_kwargs["api_key"] = session.api_key

        ll = await asyncio.to_thread(_get_litellm)
        synth_resp = await ll.acompletion(**completion_kwargs)
        final_text = (getattr(synth_resp.choices[0].message, "content", None) or "Ação concluída.").strip()

    # Keep plain text in session history to avoid bloating memory with old base64 screenshots
    if isinstance(session.history[-1]["content"], list):
        session.history[-1]["content"] = user_text
    session.history.append({"role": "assistant", "content": final_text})

    return final_text


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    return {
        "status": "online",
        "service": "jasper-backend",
        "port": 8765,
        "tools": list(AVAILABLE_FUNCTIONS.keys()),
    }


@app.get("/telemetry")
async def http_telemetry() -> Dict[str, Any]:
    raw = await asyncio.to_thread(get_system_telemetry)
    return json.loads(raw)


@app.post("/config")
async def http_update_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    dummy = JasperSession()
    dummy.update_config(payload)
    for sess in list(ACTIVE_SESSIONS):
        sess.update_config(payload)
    return {
        "status": "ok",
        "agent_name": GLOBAL_CONFIG["agent_name"],
        "model": GLOBAL_CONFIG["model"],
        "voice": GLOBAL_CONFIG["voice"],
    }


@app.websocket("/ws/jasper")
async def jasper_websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    session = JasperSession()
    ACTIVE_SESSIONS.append(session)

    await websocket.send_json(
        {
            "type": "status",
            "status": "connected",
            "message": f"{session.agent_name} Online",
            "model": session.model,
            "voice": session.voice,
        }
    )

    async def handle_prompt(user_text: str, force_vision: bool = False) -> None:
        try:
            await websocket.send_json(
                {
                    "type": "status",
                    "status": "thinking",
                    "message": f"{session.agent_name} Processando...",
                }
            )

            answer = await run_agent_loop(websocket, session, user_text, force_vision=force_vision)

            # Send text response immediately for HUD transcript
            await websocket.send_json(
                {
                    "type": "response",
                    "text": answer,
                }
            )

            # Generate neural TTS in memory (Edge-TTS) and stream base64 audio for 3D Lip-Sync
            try:
                audio_b64 = await generate_tts_base64(answer, voice=session.voice)
                if audio_b64:
                    await websocket.send_json(
                        {
                            "type": "audio",
                            "audio_base64": audio_b64,
                            "format": "mp3",
                            "text": answer,
                        }
                    )
            except Exception as tts_err:
                print(f"[TTS] Aviso ao sintetizar voz Edge-TTS: {tts_err}")

            await websocket.send_json({"type": "turn_complete"})
        except asyncio.CancelledError:
            await websocket.send_json({"type": "interrupted"})
        except Exception as exc:
            err_msg = str(exc)
            print(f"[WebSocket] Erro durante execução do agente: {err_msg}")
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Erro no processamento de IA: {err_msg[:220]}",
                }
            )
            await websocket.send_json({"type": "turn_complete"})

    try:
        while True:
            raw_message = await websocket.receive_text()
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                payload = {"type": "chat", "text": raw_message}

            msg_type = payload.get("type", "chat")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "clear_memory":
                session.clear_memory()
                await websocket.send_json(
                    {
                        "type": "memory_cleared",
                        "facts": [],
                        "message": "Memória de conversa limpa com sucesso.",
                    }
                )
                continue

            if msg_type == "get_memory":
                await websocket.send_json(
                    {
                        "type": "memory_data",
                        "facts": session.facts,
                    }
                )
                continue

            if msg_type == "config":
                session.update_config(payload)
                await websocket.send_json(
                    {
                        "type": "status",
                        "status": "connected",
                        "message": f"{session.agent_name} Online ({session.model})",
                        "model": session.model,
                        "voice": session.voice,
                    }
                )
                continue

            if msg_type == "interrupt":
                if session.current_task and not session.current_task.done():
                    session.current_task.cancel()
                await websocket.send_json({"type": "interrupted"})
                continue

            if msg_type == "audio_input":
                audio_b64 = payload.get("audio_base64", "")
                force_vision = bool(payload.get("vision", False))
                if not audio_b64:
                    continue

                await websocket.send_json(
                    {
                        "type": "status",
                        "status": "listening",
                        "message": "Transcrevendo voz...",
                    }
                )
                transcript = await transcribe_audio_base64(audio_b64, api_key=session.api_key)
                if not transcript:
                    await websocket.send_json({"type": "turn_complete"})
                    continue

                await websocket.send_json(
                    {
                        "type": "user_transcript",
                        "text": transcript,
                    }
                )
                if session.current_task and not session.current_task.done():
                    session.current_task.cancel()
                session.current_task = asyncio.create_task(
                    handle_prompt(transcript, force_vision=force_vision)
                )
                continue

            # Default: text/voice prompt ("chat" or direct {"text": ...})
            user_text = str(payload.get("text") or payload.get("prompt") or "").strip()
            if not user_text:
                continue

            force_vision = bool(payload.get("vision", False))
            if session.current_task and not session.current_task.done():
                session.current_task.cancel()
            session.current_task = asyncio.create_task(
                handle_prompt(user_text, force_vision=force_vision)
            )

    except WebSocketDisconnect:
        if session in ACTIVE_SESSIONS:
            ACTIVE_SESSIONS.remove(session)
        if session.current_task and not session.current_task.done():
            session.current_task.cancel()
        print("[WebSocket] Cliente desconectado de /ws/jasper.")
    except Exception as exc:
        if session in ACTIVE_SESSIONS:
            ACTIVE_SESSIONS.remove(session)
        print(f"[WebSocket] Erro na sessão: {exc}")


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765,
        log_level="info",
    )
