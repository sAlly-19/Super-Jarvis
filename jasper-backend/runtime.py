import asyncio
import base64
import io
import json
import os
import re
import sys
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from tools_os import (
    AVAILABLE_FUNCTIONS,
    TOOLS_SCHEMA,
    capture_screen_base64,
)

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

SUPPORTED_PROVIDER_MODELS: Dict[str, Tuple[str, ...]] = {
    "gemini": ("gemini/gemini-3.8-flash",),
    "groq": ("groq/openai/gpt-oss-120b",),
    "ollama": ("ollama/qwen2.5:3b",),
}

RETIRED_PROVIDER_MODELS: Dict[str, str] = {
    "llama-3.3-70b-versatile": "groq/openai/gpt-oss-120b",
    "groq/llama-3.3-70b-versatile": "groq/openai/gpt-oss-120b",
}

PROVIDER_LABELS: Dict[str, str] = {
    "gemini": "Google Gemini",
    "groq": "Groq",
    "ollama": "Ollama",
}

OLLAMA_LOCAL_API_BASE = "http://127.0.0.1:11434"

CREDENTIAL_REDACT_RE = re.compile(r"(AIza[0-9A-Za-z_-]{10,}|gsk_[0-9A-Za-z_-]{10,})")

VISION_KEYWORDS_RE = re.compile(
    r"\b(olhe a tela|olha a tela|veja a tela|analise a tela|o que est[áa] na tela|"
    r"o que tem na tela|leia a tela|minha tela|print da tela|captura de tela|screenshot)\b",
    re.IGNORECASE,
)


def _redact_secrets(text: str, active_key: str = "") -> str:
    sanitized = str(text or "")
    if active_key:
        sanitized = sanitized.replace(active_key, "[REDACTED]")
    return CREDENTIAL_REDACT_RE.sub("[REDACTED]", sanitized)


def normalize_model_name(raw_model: Optional[str]) -> str:
    model = (raw_model or os.getenv("JASPER_MODEL") or "gemini/gemini-3.8-flash").strip()
    if not model:
        return "gemini/gemini-3.8-flash"
    if "live" in model.lower() or "native-audio" in model.lower():
        return "gemini/gemini-3.8-flash"
    if model in RETIRED_PROVIDER_MODELS:
        return RETIRED_PROVIDER_MODELS[model]
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


def infer_provider_from_model(model: Optional[str]) -> str:
    normalized = normalize_model_name(model)
    prefix = normalized.split("/", 1)[0].strip().lower() if "/" in normalized else ""
    if prefix in SUPPORTED_PROVIDER_MODELS and normalized in SUPPORTED_PROVIDER_MODELS[prefix]:
        return prefix
    return "gemini"


def validate_provider_model(provider: Optional[str], model: Optional[str]) -> Tuple[str, str]:
    normalized_provider = str(provider or "").strip().lower()
    normalized_model = str(model or "").strip()

    if normalized_provider not in SUPPORTED_PROVIDER_MODELS:
        raise ValueError("Provedor de IA não suportado.")

    allowed_models = SUPPORTED_PROVIDER_MODELS[normalized_provider]
    if not normalized_model.startswith(f"{normalized_provider}/") or normalized_model not in allowed_models:
        raise ValueError(f"Modelo não suportado para o provedor {PROVIDER_LABELS[normalized_provider]}.")

    return normalized_provider, normalized_model


def format_provider_error(provider: str) -> str:
    if provider == "ollama":
        return (
            f"Serviço local Ollama indisponível em {OLLAMA_LOCAL_API_BASE}. "
            "Verifique se o Ollama está em execução e se o modelo qwen2.5:3b está instalado."
        )
    label = PROVIDER_LABELS.get(provider, "IA")
    return f"Não foi possível concluir a solicitação no provedor {label}. Verifique a credencial configurada e a conexão."


def resolve_voice_name(raw_voice: Optional[str]) -> str:
    voice = (raw_voice or os.getenv("JASPER_VOICE") or "pt-BR-AntonioNeural").strip()
    return VOICE_MAP.get(voice, voice if "Neural" in voice else "pt-BR-AntonioNeural")


def clean_text_for_speech(text: str) -> str:
    cleaned = re.sub(r"```[\s\S]*?```", " código exibido na tela. ", text or "")
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"[*_#~>|]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


async def generate_tts_base64(text: str, voice: str = "pt-BR-AntonioNeural") -> str:
    spoken_text = clean_text_for_speech(text)
    if not spoken_text:
        return ""
    try:
        import edge_tts

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
    except Exception as exc:
        print(f"[TTS] Warning: TTS generation failed: {exc}", file=sys.stderr)
        return ""


def _transcribe_wav_sync(wav_bytes: bytes, api_key: str = "", provider: str = "") -> str:
    groq_key = api_key if (provider == "groq" and api_key) else ""
    if groq_key:
        try:
            import litellm

            file_tuple = ("speech.wav", io.BytesIO(wav_bytes), "audio/wav")
            resp = litellm.transcription(
                model="groq/whisper-large-v3-turbo",
                file=file_tuple,
                language="pt",
                api_key=groq_key,
            )
            text = getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "")
            if text and str(text).strip():
                return str(text).strip()
        except Exception as exc:
            print(f"[STT] Groq Whisper fallback: {_redact_secrets(str(exc), groq_key)}", file=sys.stderr)

    try:
        import speech_recognition as sr

        recognizer = sr.Recognizer()
        with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
            audio_data = recognizer.record(source)
        text = recognizer.recognize_google(audio_data, language="pt-BR")
        return (text or "").strip()
    except Exception as exc:
        print(f"[STT] Failed to transcribe audio: {_redact_secrets(str(exc), api_key)}", file=sys.stderr)
        return ""


async def transcribe_audio_base64(audio_b64: str, api_key: str = "", provider: str = "") -> str:
    try:
        wav_bytes = base64.b64decode(audio_b64)
        return await asyncio.to_thread(_transcribe_wav_sync, wav_bytes, api_key, provider)
    except Exception as exc:
        print(f"[STT] Base64 decode error: {_redact_secrets(str(exc), api_key)}", file=sys.stderr)
        return ""


class JasperRuntime:
    def __init__(self) -> None:
        initial_provider = infer_provider_from_model(os.getenv("JASPER_MODEL", "gemini/gemini-3.8-flash"))
        initial_model = SUPPORTED_PROVIDER_MODELS[initial_provider][0]
        if initial_provider == "gemini":
            initial_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
        elif initial_provider == "groq":
            initial_key = os.getenv("GROQ_API_KEY") or ""
        else:
            initial_key = ""

        self.config: Dict[str, Any] = {
            "provider": initial_provider,
            "agent_name": os.getenv("JASPER_AGENT_NAME", "Jasper"),
            "model": initial_model,
            "voice": resolve_voice_name(os.getenv("JASPER_VOICE", "pt-BR-AntonioNeural")),
            "api_key": initial_key,
            "vision_enabled": False,
        }
        self.history: List[Dict[str, Any]] = []
        self.facts: List[Dict[str, str]] = []
        self.current_task: Optional[asyncio.Task[Any]] = None

    def build_system_prompt(self) -> str:
        agent_name = self.config["agent_name"]
        facts_block = ""
        if self.facts:
            facts_lines = "\n".join(f"- {f['fact']}" for f in self.facts[-20:])
            facts_block = f"\n\nFatos memorizados sobre o usuário:\n{facts_lines}"

        return (
            f"Você é {agent_name}, um assistente de IA Sci-Fi avançado, altamente capaz, "
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
        raw_model = str(data.get("model") or self.config["model"]).strip()
        raw_provider = (
            str(data["provider"]).strip().lower()
            if data.get("provider") is not None
            else (raw_model.split("/", 1)[0].strip().lower() if "/" in raw_model else str(self.config["provider"]))
        )
        provider, validated_model = validate_provider_model(raw_provider, raw_model)

        if provider == "ollama":
            resolved_key = ""
        else:
            if "api_key" in data or "apiKey" in data:
                candidate = str(data.get("api_key") or data.get("apiKey") or "").strip()
                resolved_key = self.config["api_key"] if "..." in candidate else candidate
            elif self.config.get("provider") == provider:
                resolved_key = str(self.config.get("api_key") or "").strip()
            else:
                resolved_key = ""

            if not resolved_key:
                raise ValueError(f"Credencial obrigatória ausente para o provedor {PROVIDER_LABELS[provider]}.")

        if data.get("agent_name") or data.get("agentName"):
            self.config["agent_name"] = str(data.get("agent_name") or data.get("agentName")).strip()
        self.config["provider"] = provider
        self.config["model"] = validated_model
        self.config["api_key"] = resolved_key

        if data.get("voice") or data.get("voiceName"):
            self.config["voice"] = resolve_voice_name(str(data.get("voice") or data.get("voiceName")))
        if "vision" in data or "enableScreenAwareness" in data:
            val = data.get("vision") if "vision" in data else data.get("enableScreenAwareness")
            if isinstance(val, bool):
                self.config["vision_enabled"] = val

    def clear_memory(self) -> None:
        self.history.clear()
        self.facts.clear()

    def maybe_memorize_fact(self, user_text: str) -> Optional[Dict[str, str]]:
        lower = user_text.lower()
        triggers = ("meu nome é", "eu gosto de", "prefiro ", "trabalho com", "lembre que", "memorize que")
        if any(t in lower for t in triggers):
            clean_fact = user_text.strip()
            if clean_fact and not any(f.get("fact") == clean_fact for f in self.facts):
                item = {"fact": clean_fact}
                self.facts.append(item)
                return item
        return None

    async def _run_agent_turn(
        self,
        req_id: str,
        user_text: str,
        force_vision: bool = False,
    ) -> AsyncIterator[Dict[str, Any]]:
        provider, validated_model = validate_provider_model(
            self.config.get("provider"),
            self.config.get("model"),
        )
        active_key = str(self.config.get("api_key") or "").strip()
        if provider in ("gemini", "groq") and not active_key:
            missing_msg = f"Credencial obrigatória ausente para o provedor {PROVIDER_LABELS[provider]}."
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": req_id,
                "type": "error",
                "payload": {"message": missing_msg},
            }
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": req_id,
                "type": "turn_complete",
                "payload": {},
            }
            return

        new_fact = self.maybe_memorize_fact(user_text)
        if new_fact:
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": req_id,
                "type": "memory_upsert",
                "payload": {"facts": [new_fact]},
            }

        needs_vision = force_vision or self.config["vision_enabled"] or bool(VISION_KEYWORDS_RE.search(user_text))
        user_message_content: Any = user_text

        if needs_vision and provider != "ollama":
            try:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": req_id,
                    "type": "tool_execution",
                    "payload": {"tool": "capture_screen_base64", "args": {"auto_vision": True}},
                }
                screen_b64 = await asyncio.to_thread(capture_screen_base64)
                if screen_b64:
                    user_message_content = [
                        {"type": "text", "text": user_text},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{screen_b64}"},
                        },
                    ]
            except Exception as exc:
                print(f"[AgentLoop] Screen capture error: {_redact_secrets(str(exc), active_key)}", file=sys.stderr)

        self.history.append({"role": "user", "content": user_message_content})
        if len(self.history) > 16:
            self.history = self.history[-16:]

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": self.build_system_prompt()},
            *self.history,
        ]

        final_text = ""
        max_iterations = 5

        try:
            import litellm

            litellm.drop_params = True
            litellm.suppress_debug_info = True

            for _iteration in range(max_iterations):
                completion_kwargs: Dict[str, Any] = {
                    "model": validated_model,
                    "messages": messages,
                    "tools": TOOLS_SCHEMA,
                    "tool_choice": "auto",
                    "temperature": 0.4,
                }
                if provider == "ollama":
                    completion_kwargs["api_base"] = OLLAMA_LOCAL_API_BASE
                else:
                    completion_kwargs["api_key"] = active_key

                response = await litellm.acompletion(**completion_kwargs)
                choice_msg = response.choices[0].message
                tool_calls = getattr(choice_msg, "tool_calls", None)

                if not tool_calls:
                    final_text = (getattr(choice_msg, "content", None) or "").strip()
                    break

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

                    yield {
                        "version": 1,
                        "id": str(uuid.uuid4()),
                        "replyTo": req_id,
                        "type": "tool_execution",
                        "payload": {"tool": fn_name, "args": fn_args},
                    }

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
                                    "info": "Captura de tela realizada com sucesso.",
                                    "size_kb": round(len(img_b64) * 3 / 4 / 1024, 1),
                                },
                                ensure_ascii=False,
                            )
                        except Exception as exc:
                            tool_result = json.dumps(
                                {"status": "error", "error": _redact_secrets(str(exc), active_key)},
                                ensure_ascii=False,
                            )
                    else:
                        try:
                            tool_result = await asyncio.to_thread(fn_to_call, **fn_args)
                        except Exception as exc:
                            tool_result = json.dumps(
                                {"status": "error", "error": _redact_secrets(str(exc), active_key)},
                                ensure_ascii=False,
                            )

                    yield {
                        "version": 1,
                        "id": str(uuid.uuid4()),
                        "replyTo": req_id,
                        "type": "tool_result",
                        "payload": {"tool": fn_name, "result": tool_result},
                    }

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "name": fn_name,
                            "content": str(tool_result),
                        }
                    )

            if not final_text:
                completion_kwargs = {
                    "model": validated_model,
                    "messages": messages,
                    "temperature": 0.4,
                }
                if provider == "ollama":
                    completion_kwargs["api_base"] = OLLAMA_LOCAL_API_BASE
                else:
                    completion_kwargs["api_key"] = active_key

                synth_resp = await litellm.acompletion(**completion_kwargs)
                final_text = (getattr(synth_resp.choices[0].message, "content", None) or "Ação concluída.").strip()

        except ImportError:
            final_text = f"[{self.config['agent_name']}] Mensagem recebida: {user_text}"
        except Exception as exc:
            print(f"[AgentLoop] LLM error ({provider}): {type(exc).__name__}", file=sys.stderr)
            final_text = format_provider_error(provider)

        if isinstance(self.history[-1]["content"], list):
            self.history[-1]["content"] = user_text
        self.history.append({"role": "assistant", "content": final_text})

        yield {
            "version": 1,
            "id": str(uuid.uuid4()),
            "replyTo": req_id,
            "type": "response",
            "payload": {"text": final_text},
        }

        try:
            audio_b64 = await generate_tts_base64(final_text, voice=self.config["voice"])
            if audio_b64:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": req_id,
                    "type": "audio_output",
                    "payload": {
                        "audio_base64": audio_b64,
                        "format": "mp3",
                        "text": final_text,
                    },
                }
        except Exception as tts_err:
            print(f"[TTS] Voice synthesis error: {tts_err}", file=sys.stderr)

        yield {
            "version": 1,
            "id": str(uuid.uuid4()),
            "replyTo": req_id,
            "type": "turn_complete",
            "payload": {},
        }

    async def handle(self, message: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        msg_type = message.get("type")
        msg_id = message.get("id", str(uuid.uuid4()))
        payload = message.get("payload", {}) or {}

        if msg_type == "hello":
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "hello_ack",
                "payload": {
                    "service": "jasper-backend",
                    "protocolVersion": 1,
                    "tools": [t["function"]["name"] for t in TOOLS_SCHEMA],
                    "status": "ready",
                },
            }
            return

        if msg_type == "shutdown":
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "status",
                "payload": {"status": "shutting_down"},
            }
            return

        if msg_type == "config":
            try:
                self.update_config(payload)
            except ValueError as exc:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "error",
                    "payload": {"message": _redact_secrets(str(exc), str(payload.get("apiKey") or payload.get("api_key") or ""))},
                }
                return

            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "status",
                "payload": {
                    "status": "connected",
                    "provider": self.config["provider"],
                    "agent_name": self.config["agent_name"],
                    "model": self.config["model"],
                    "voice": self.config["voice"],
                },
            }
            return

        if msg_type == "memory_snapshot":
            incoming_facts = payload.get("facts", [])
            if incoming_facts:
                self.facts.clear()
                for item in incoming_facts:
                    if isinstance(item, dict) and "fact" in item:
                        self.facts.append({"fact": str(item["fact"])})
                    elif isinstance(item, str):
                        self.facts.append({"fact": item})
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "memory_upsert",
                "payload": {"facts": list(self.facts)},
            }
            return

        if msg_type == "memory_clear":
            self.clear_memory()
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "memory_clear",
                "payload": {"status": "cleared", "facts": []},
            }
            return

        if msg_type == "interrupt":
            if self.current_task and not self.current_task.done():
                self.current_task.cancel()
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "interrupted",
                "payload": {},
            }
            return

        if msg_type == "audio_input":
            audio_b64 = payload.get("audio_base64", "")
            force_vision = bool(payload.get("vision", False))
            if not audio_b64:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "turn_complete",
                    "payload": {},
                }
                return

            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "status",
                "payload": {"status": "listening", "message": "Transcrevendo voz..."},
            }

            transcript = await transcribe_audio_base64(
                audio_b64,
                api_key=self.config["api_key"],
                provider=self.config["provider"],
            )
            if not transcript:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "turn_complete",
                    "payload": {},
                }
                return

            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "user_transcript",
                "payload": {"text": transcript},
            }

            try:
                async for item in self._run_agent_turn(msg_id, transcript, force_vision=force_vision):
                    yield item
            except asyncio.CancelledError:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "interrupted",
                    "payload": {},
                }
            except Exception as exc:
                print(
                    f"[AgentLoop] Audio turn error: {_redact_secrets(str(exc), self.config['api_key'])}",
                    file=sys.stderr,
                )
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "error",
                    "payload": {"message": format_provider_error(self.config["provider"])},
                }
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "turn_complete",
                    "payload": {},
                }
            return

        if msg_type == "chat":
            user_text = str(payload.get("text") or payload.get("prompt") or "").strip()
            if not user_text:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "turn_complete",
                    "payload": {},
                }
                return

            force_vision = bool(payload.get("vision", False))
            yield {
                "version": 1,
                "id": str(uuid.uuid4()),
                "replyTo": msg_id,
                "type": "status",
                "payload": {"status": "thinking", "message": f"{self.config['agent_name']} Processando..."},
            }

            try:
                async for item in self._run_agent_turn(msg_id, user_text, force_vision=force_vision):
                    yield item
            except asyncio.CancelledError:
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "interrupted",
                    "payload": {},
                }
            except Exception as exc:
                print(
                    f"[AgentLoop] Chat turn error: {_redact_secrets(str(exc), self.config['api_key'])}",
                    file=sys.stderr,
                )
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "error",
                    "payload": {"message": format_provider_error(self.config["provider"])},
                }
                yield {
                    "version": 1,
                    "id": str(uuid.uuid4()),
                    "replyTo": msg_id,
                    "type": "turn_complete",
                    "payload": {},
                }
            return

        yield {
            "version": 1,
            "id": str(uuid.uuid4()),
            "replyTo": msg_id,
            "type": "error",
            "payload": {"message": f"Tipo de mensagem desconhecido: '{msg_type}'"},
        }
