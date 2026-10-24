import base64
import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


OLLAMA_LOCAL_API_BASE = "http://127.0.0.1:11434"


@dataclass(frozen=True)
class ProviderToolCall:
    id: str
    name: str
    arguments: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderResponse:
    content: str
    tool_calls: List[ProviderToolCall]
    assistant_message: Dict[str, Any]


class ProviderAdapterError(RuntimeError):
    def __init__(self, category: str, user_message: str) -> None:
        super().__init__(user_message)
        self.category = category
        self.user_message = user_message


def _value(source: Any, name: str, default: Any = None) -> Any:
    if isinstance(source, dict):
        return source.get(name, default)
    return getattr(source, name, default)


def _remote_model(provider: str, model: str) -> str:
    prefix = f"{provider}/"
    if not model.startswith(prefix) or len(model) <= len(prefix):
        raise ProviderAdapterError("model", f"Modelo inválido para o provedor {provider}.")
    return model[len(prefix):]


def _decode_arguments(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            decoded = json.loads(raw)
            return decoded if isinstance(decoded, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def _status_code(exc: Exception) -> Optional[int]:
    for candidate in (getattr(exc, "status_code", None), getattr(getattr(exc, "response", None), "status_code", None)):
        if isinstance(candidate, int):
            return candidate
    return None


def _safe_provider_error(provider: str, exc: Exception, model: str = "") -> ProviderAdapterError:
    label = {"gemini": "Google Gemini", "groq": "Groq", "ollama": "Ollama"}.get(provider, provider)
    status = _status_code(exc)
    raw = str(exc).lower()
    class_name = type(exc).__name__.lower()

    if status in (401, 403) or any(token in raw for token in ("invalid api key", "unauthorized", "permission_denied")):
        return ProviderAdapterError(
            "authentication",
            f"A credencial do provedor {label} foi recusada. Verifique a chave configurada.",
        )
    if status == 429 or any(token in raw for token in ("rate limit", "resource_exhausted", "quota")):
        return ProviderAdapterError(
            "quota",
            f"A cota do provedor {label} foi atingida. Verifique os limites e o faturamento da conta.",
        )
    if status == 404 or any(token in raw for token in ("model_not_found", "model not found", "not available")):
        remote = model.split("/", 1)[-1] if model else "selecionado"
        return ProviderAdapterError(
            "model",
            f"O modelo {remote} não está disponível para esta conta no provedor {label}.",
        )
    if status in (408, 502, 503, 504) or any(
        token in raw or token in class_name
        for token in ("timeout", "connection", "connecterror", "network", "dns")
    ):
        if provider == "ollama":
            return ProviderAdapterError(
                "network",
                f"Serviço local Ollama indisponível em {OLLAMA_LOCAL_API_BASE}.",
            )
        return ProviderAdapterError(
            "network",
            f"Não foi possível conectar ao provedor {label}. Verifique a conexão de rede.",
        )
    return ProviderAdapterError(
        "service",
        f"O provedor {label} recusou a solicitação. Tente novamente ou valide a configuração.",
    )


def _canonical_response(content: Any, raw_tool_calls: Any) -> ProviderResponse:
    text = str(content or "").strip()
    normalized: List[ProviderToolCall] = []
    for raw_call in raw_tool_calls or []:
        function = _value(raw_call, "function", {})
        name = str(_value(function, "name", "") or "").strip()
        if not name:
            continue
        call_id = str(_value(raw_call, "id", "") or uuid.uuid4())
        normalized.append(
            ProviderToolCall(
                id=call_id,
                name=name,
                arguments=_decode_arguments(_value(function, "arguments", {})),
            )
        )

    assistant: Dict[str, Any] = {"role": "assistant", "content": text}
    if normalized:
        assistant["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments, ensure_ascii=False),
                },
            }
            for call in normalized
        ]
    return ProviderResponse(content=text, tool_calls=normalized, assistant_message=assistant)


class GroqAdapter:
    provider = "groq"

    def __init__(self, api_key: str, client: Any = None) -> None:
        if client is None:
            from groq import AsyncGroq

            client = AsyncGroq(api_key=api_key)
        self.client = client

    async def validate_model(self, model: str) -> None:
        remote_model = _remote_model(self.provider, model)
        try:
            await self.client.models.retrieve(remote_model)
        except Exception as exc:
            raise _safe_provider_error(self.provider, exc, model) from exc

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        temperature: float,
    ) -> ProviderResponse:
        remote_model = _remote_model(self.provider, model)
        request: Dict[str, Any] = {
            "model": remote_model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            request["tools"] = tools
            request["tool_choice"] = "auto"
        try:
            response = await self.client.chat.completions.create(**request)
            message = response.choices[0].message
            return _canonical_response(_value(message, "content", ""), _value(message, "tool_calls", []))
        except ProviderAdapterError:
            raise
        except Exception as exc:
            raise _safe_provider_error(self.provider, exc, model) from exc

    async def aclose(self) -> None:
        closer = getattr(self.client, "close", None)
        if closer:
            result = closer()
            if hasattr(result, "__await__"):
                await result


def _gemini_parts(content: Any) -> List[Dict[str, Any]]:
    if isinstance(content, str):
        return [{"text": content}]
    parts: List[Dict[str, Any]] = []
    if not isinstance(content, list):
        return parts
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text" and item.get("text"):
            parts.append({"text": str(item["text"])})
            continue
        if item.get("type") != "image_url":
            continue
        url = str((item.get("image_url") or {}).get("url") or "")
        if not url.startswith("data:") or ";base64," not in url:
            continue
        header, encoded = url.split(",", 1)
        mime_type = header[5:].split(";", 1)[0]
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            continue
        if data:
            parts.append({"inline_data": {"mime_type": mime_type, "data": data}})
    return parts


def _gemini_contents(messages: List[Dict[str, Any]]) -> tuple[str, List[Dict[str, Any]]]:
    system_parts: List[str] = []
    contents: List[Dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "")
        if role == "system":
            system_parts.append(str(message.get("content") or ""))
            continue
        if role == "user":
            parts = _gemini_parts(message.get("content"))
            if parts:
                contents.append({"role": "user", "parts": parts})
            continue
        if role == "assistant":
            parts = _gemini_parts(message.get("content"))
            for tool_call in message.get("tool_calls") or []:
                function = tool_call.get("function") or {}
                parts.append(
                    {
                        "function_call": {
                            "id": str(tool_call.get("id") or uuid.uuid4()),
                            "name": str(function.get("name") or ""),
                            "args": _decode_arguments(function.get("arguments")),
                        }
                    }
                )
            if parts:
                contents.append({"role": "model", "parts": parts})
            continue
        if role == "tool":
            raw_result = message.get("content")
            try:
                parsed_result = json.loads(raw_result) if isinstance(raw_result, str) else raw_result
            except (TypeError, ValueError):
                parsed_result = {"result": str(raw_result or "")}
            if not isinstance(parsed_result, dict):
                parsed_result = {"result": parsed_result}
            contents.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "function_response": {
                                "id": str(message.get("tool_call_id") or ""),
                                "name": str(message.get("name") or ""),
                                "response": parsed_result,
                            }
                        }
                    ],
                }
            )
    return "\n".join(part for part in system_parts if part), contents


class GeminiAdapter:
    provider = "gemini"

    def __init__(self, api_key: str, client: Any = None) -> None:
        if client is None:
            from google import genai

            client = genai.Client(api_key=api_key)
        self.client = client
        self.async_client = client.aio

    async def validate_model(self, model: str) -> None:
        remote_model = _remote_model(self.provider, model)
        try:
            await self.async_client.models.get(model=remote_model)
        except Exception as exc:
            raise _safe_provider_error(self.provider, exc, model) from exc

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        temperature: float,
    ) -> ProviderResponse:
        remote_model = _remote_model(self.provider, model)
        system_instruction, contents = _gemini_contents(messages)
        config: Dict[str, Any] = {
            "temperature": temperature,
            "automatic_function_calling": {"disable": True},
        }
        if system_instruction:
            config["system_instruction"] = system_instruction
        if tools:
            config["tools"] = [
                {
                    "function_declarations": [
                        dict(tool.get("function") or {})
                        for tool in tools
                        if tool.get("type") == "function" and tool.get("function")
                    ]
                }
            ]
        try:
            response = await self.async_client.models.generate_content(
                model=remote_model,
                contents=contents,
                config=config,
            )
            candidates = _value(response, "candidates", []) or []
            parts = _value(_value(candidates[0], "content", {}), "parts", []) if candidates else []
            text_parts: List[str] = []
            calls: List[Dict[str, Any]] = []
            for part in parts or []:
                text = _value(part, "text", None)
                if text:
                    text_parts.append(str(text))
                function_call = _value(part, "function_call", None)
                if function_call and _value(function_call, "name", ""):
                    calls.append(
                        {
                            "id": str(_value(function_call, "id", "") or uuid.uuid4()),
                            "function": {
                                "name": str(_value(function_call, "name", "")),
                                "arguments": _value(function_call, "args", {}) or {},
                            },
                        }
                    )
            return _canonical_response("".join(text_parts), calls)
        except ProviderAdapterError:
            raise
        except Exception as exc:
            raise _safe_provider_error(self.provider, exc, model) from exc

    async def aclose(self) -> None:
        closer = getattr(self.async_client, "aclose", None)
        if closer:
            await closer()
        sync_closer = getattr(self.client, "close", None)
        if sync_closer:
            sync_closer()


class OllamaAdapter:
    provider = "ollama"

    def __init__(self, api_key: str = "", client: Any = None) -> None:
        if client is None:
            import httpx

            client = httpx.AsyncClient(base_url=OLLAMA_LOCAL_API_BASE, timeout=45.0)
        self.client = client

    async def validate_model(self, model: str) -> None:
        remote_model = _remote_model(self.provider, model)
        try:
            response = await self.client.get("/api/tags")
            response.raise_for_status()
            available = {
                str(item.get("name") or item.get("model") or "")
                for item in (response.json().get("models") or [])
                if isinstance(item, dict)
            }
            if remote_model not in available:
                raise ProviderAdapterError(
                    "model",
                    f"O modelo local {remote_model} não está instalado no Ollama.",
                )
        except ProviderAdapterError:
            raise
        except Exception as exc:
            raise _safe_provider_error(self.provider, exc, model) from exc

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        temperature: float,
    ) -> ProviderResponse:
        remote_model = _remote_model(self.provider, model)
        payload: Dict[str, Any] = {
            "model": remote_model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = tools
        try:
            response = await self.client.post("/api/chat", json=payload)
            response.raise_for_status()
            message = response.json().get("message") or {}
            return _canonical_response(message.get("content", ""), message.get("tool_calls", []))
        except ProviderAdapterError:
            raise
        except Exception as exc:
            raise _safe_provider_error(self.provider, exc, model) from exc

    async def aclose(self) -> None:
        closer = getattr(self.client, "aclose", None)
        if closer:
            await closer()


def create_provider_adapter(provider: str, api_key: str = "") -> Any:
    normalized = str(provider or "").strip().lower()
    if normalized == "gemini":
        return GeminiAdapter(api_key)
    if normalized == "groq":
        return GroqAdapter(api_key)
    if normalized == "ollama":
        return OllamaAdapter()
    raise ValueError("Provedor de IA não suportado.")
