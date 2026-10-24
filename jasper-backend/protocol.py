import struct
import json
from typing import Any, Dict, List

MAX_FRAME_BODY_LENGTH = 16 * 1024 * 1024  # 16 MiB
MAX_ID_LENGTH = 160
MAX_TYPE_LENGTH = 160
MAX_CHAT_TEXT_LENGTH = 20_000

HOST_TO_SIDECAR_MESSAGE_TYPES = (
    "hello", "config", "chat", "audio_input", "interrupt", "memory_snapshot", "memory_clear", "shutdown",
    "live_start", "live_audio", "live_stop",
)
SIDECAR_TO_HOST_MESSAGE_TYPES = (
    "hello_ack", "status", "user_transcript", "response", "audio_output", "tool_execution", "tool_result",
    "memory_upsert", "memory_clear", "turn_complete", "interrupted", "error",
)
ALL_MESSAGE_TYPES = HOST_TO_SIDECAR_MESSAGE_TYPES + tuple(
    message_type for message_type in SIDECAR_TO_HOST_MESSAGE_TYPES if message_type != "memory_clear"
)


class FrameError(Exception):
    """Exceção levantada em violações do protocolo de enquadramento do sidecar."""
    pass


def _require_string(payload: Dict[str, Any], field: str, allow_empty: bool = False) -> None:
    value = payload.get(field)
    if not isinstance(value, str) or (not allow_empty and not value):
        raise FrameError(f"Payload '{field}' deve ser uma string{' não vazia' if not allow_empty else ''}.")


def _validate_payload(msg_type: str, payload: Any) -> None:
    if not isinstance(payload, dict):
        raise FrameError(f"Payload inválido para '{msg_type}': esperado objeto.")

    if msg_type == "hello":
        _require_string(payload, "client")
        if payload.get("protocolVersion") != 1:
            raise FrameError("Payload 'protocolVersion' deve ser 1.")
    elif msg_type == "config":
        for field in ("agent_name", "model", "voice"):
            _require_string(payload, field)
        if "apiKey" in payload and not isinstance(payload["apiKey"], str):
            raise FrameError("Payload 'apiKey' inválido.")
        if "vision" in payload and not isinstance(payload["vision"], bool):
            raise FrameError("Payload 'vision' inválido.")
    elif msg_type == "chat":
        _require_string(payload, "text")
        if len(payload["text"]) > MAX_CHAT_TEXT_LENGTH:
            raise FrameError(f"Texto de chat excede limite de {MAX_CHAT_TEXT_LENGTH} caracteres.")
        if "vision" in payload and not isinstance(payload["vision"], bool):
            raise FrameError("Payload 'vision' inválido.")
    elif msg_type == 'live_start':
        _require_string(payload, 'apiKey')
        _require_string(payload, 'voice')
        if len(payload['apiKey']) > 512 or len(payload['voice']) > 80:
            raise FrameError('Configuração Live excede o limite.')
        if 'greeting' in payload and not isinstance(payload['greeting'], bool):
            raise FrameError('greeting deve ser booleano.')
    elif msg_type == 'live_audio':
        _require_string(payload, 'audio_base64')
        if len(payload['audio_base64']) > 65536:
            raise FrameError('Bloco Live excede o limite.')
    elif msg_type == "audio_input":
        _require_string(payload, "audio_base64")
        if "vision" in payload and not isinstance(payload["vision"], bool):
            raise FrameError("Payload 'vision' inválido.")
    elif msg_type in ("memory_snapshot", "memory_upsert"):
        if not isinstance(payload.get("facts"), list):
            raise FrameError("Payload 'facts' deve ser um array.")
    elif msg_type == "hello_ack":
        _require_string(payload, "service")
        if payload.get("protocolVersion") != 1:
            raise FrameError("Payload 'protocolVersion' deve ser 1.")
        if not isinstance(payload.get("tools"), list) or not all(isinstance(tool, str) for tool in payload["tools"]):
            raise FrameError("Payload 'tools' deve ser um array de strings.")
    elif msg_type == "status":
        _require_string(payload, "status")
    elif msg_type in ("user_transcript", "response"):
        _require_string(payload, "text", allow_empty=True)
    elif msg_type == "audio_output":
        _require_string(payload, "audio_base64")
        _require_string(payload, "format")
        _require_string(payload, "text", allow_empty=True)
    elif msg_type == "tool_execution":
        _require_string(payload, "tool")
        if not isinstance(payload.get("args"), dict):
            raise FrameError("Payload 'args' deve ser um objeto.")
    elif msg_type == "tool_result":
        _require_string(payload, "tool")
        if "result" not in payload:
            raise FrameError("Payload 'result' é obrigatório.")
    elif msg_type == "error":
        _require_string(payload, "message")


def validate_envelope(env: Any) -> None:
    if not isinstance(env, dict):
        raise FrameError("Envelope deve ser um objeto JSON (dicionário).")

    if env.get("version") != 1:
        raise FrameError(f"Versão do protocolo incompatível: esperada 1, recebida {env.get('version')}.")

    msg_id = env.get("id")
    if not isinstance(msg_id, str) or not msg_id or len(msg_id) > MAX_ID_LENGTH:
        raise FrameError(f"ID inválido ou excede limite de {MAX_ID_LENGTH} caracteres.")

    reply_to = env.get("replyTo")
    if reply_to is not None and (not isinstance(reply_to, str) or not reply_to or len(reply_to) > MAX_ID_LENGTH):
        raise FrameError(f"replyTo inválido ou excede limite de {MAX_ID_LENGTH} caracteres.")

    msg_type = env.get("type")
    if not isinstance(msg_type, str) or not msg_type or len(msg_type) > MAX_TYPE_LENGTH:
        raise FrameError(f"Tipo de mensagem inválido ou excede limite de {MAX_TYPE_LENGTH} caracteres.")

    if msg_type not in ALL_MESSAGE_TYPES:
        raise FrameError(f"Tipo de mensagem desconhecido: '{msg_type}'.")
    if "payload" not in env:
        raise FrameError("Payload ausente no envelope.")
    _validate_payload(msg_type, env["payload"])


def validate_incoming_state(env: Dict[str, Any], handshake_complete: bool) -> None:
    msg_type = env.get("type")
    if msg_type not in HOST_TO_SIDECAR_MESSAGE_TYPES:
        raise FrameError(f"Tipo '{msg_type}' não permitido na direção host para sidecar.")
    if not handshake_complete and msg_type != "hello":
        raise FrameError("A primeira mensagem da sessão deve ser 'hello'.")
    if handshake_complete and msg_type == "hello":
        raise FrameError("Mensagem 'hello' duplicada após handshake.")


def encode_frame(message: Dict[str, Any]) -> bytes:
    validate_envelope(message)
    body_bytes = json.dumps(message, ensure_ascii=False, separators=(',', ':')).encode("utf-8")

    if len(body_bytes) == 0:
        raise FrameError("Comprimento do corpo do frame não pode ser 0.")

    if len(body_bytes) > MAX_FRAME_BODY_LENGTH:
        raise FrameError(f"Tamanho do frame excede o limite máximo de {MAX_FRAME_BODY_LENGTH} bytes.")

    prefix = struct.pack(">I", len(body_bytes))
    return prefix + body_bytes


class FrameDecoder:
    def __init__(self, allowed_types=None) -> None:
        self.buffer = bytearray()
        self.allowed_types = frozenset(allowed_types) if allowed_types is not None else None

    def feed(self, chunk: bytes) -> List[Dict[str, Any]]:
        if not chunk:
            return []

        self.buffer.extend(chunk)
        frames: List[Dict[str, Any]] = []

        while len(self.buffer) >= 4:
            declared_len = struct.unpack(">I", self.buffer[:4])[0]

            if declared_len == 0:
                raise FrameError("Frame declarado com tamanho 0 inválido.")

            if declared_len > MAX_FRAME_BODY_LENGTH:
                raise FrameError(f"Comprimento do frame ({declared_len}) excede o limite de {MAX_FRAME_BODY_LENGTH} bytes.")

            total_frame_len = 4 + declared_len
            if len(self.buffer) < total_frame_len:
                # Frame parcial, aguardar mais chunks
                break

            body_bytes = self.buffer[4:total_frame_len]
            # Consome o frame do buffer
            del self.buffer[:total_frame_len]

            try:
                body_str = body_bytes.decode("utf-8")
                envelope = json.loads(body_str)
            except Exception as err:
                raise FrameError(f"Falha ao decodificar payload JSON do frame: {err}")

            validate_envelope(envelope)
            if self.allowed_types is not None and envelope["type"] not in self.allowed_types:
                raise FrameError(f"Tipo '{envelope['type']}' não permitido nesta direção do protocolo.")
            frames.append(envelope)

        return frames

    def push(self, chunk: bytes) -> List[Dict[str, Any]]:
        return self.feed(chunk)
