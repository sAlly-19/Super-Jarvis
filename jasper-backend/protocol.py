import struct
import json
from typing import Any, Dict, List

MAX_FRAME_BODY_LENGTH = 16 * 1024 * 1024  # 16 MiB
MAX_ID_LENGTH = 160
MAX_TYPE_LENGTH = 160
MAX_CHAT_TEXT_LENGTH = 20_000


class FrameError(Exception):
    """Exceção levantada em violações do protocolo de enquadramento do sidecar."""
    pass


def validate_envelope(env: Any) -> None:
    if not isinstance(env, dict):
        raise FrameError("Envelope deve ser um objeto JSON (dicionário).")

    if env.get("version") != 1:
        raise FrameError(f"Versão do protocolo incompatível: esperada 1, recebida {env.get('version')}.")

    msg_id = env.get("id")
    if not isinstance(msg_id, str) or len(msg_id) > MAX_ID_LENGTH:
        raise FrameError(f"ID inválido ou excede limite de {MAX_ID_LENGTH} caracteres.")

    reply_to = env.get("replyTo")
    if reply_to is not None and (not isinstance(reply_to, str) or len(reply_to) > MAX_ID_LENGTH):
        raise FrameError(f"replyTo inválido ou excede limite de {MAX_ID_LENGTH} caracteres.")

    msg_type = env.get("type")
    if not isinstance(msg_type, str) or len(msg_type) > MAX_TYPE_LENGTH:
        raise FrameError(f"Tipo de mensagem inválido ou excede limite de {MAX_TYPE_LENGTH} caracteres.")

    if msg_type == "chat":
        payload = env.get("payload")
        if isinstance(payload, dict):
            text = payload.get("text")
            if isinstance(text, str) and len(text) > MAX_CHAT_TEXT_LENGTH:
                raise FrameError(f"Texto de chat excede limite de {MAX_CHAT_TEXT_LENGTH} caracteres.")


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
    def __init__(self) -> None:
        self.buffer = bytearray()

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
            frames.append(envelope)

        return frames

    def push(self, chunk: bytes) -> List[Dict[str, Any]]:
        return self.feed(chunk)
