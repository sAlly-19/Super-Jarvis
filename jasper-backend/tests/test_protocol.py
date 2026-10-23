import unittest
import struct
import json
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from protocol import (
    ALL_MESSAGE_TYPES,
    HOST_TO_SIDECAR_MESSAGE_TYPES,
    SIDECAR_TO_HOST_MESSAGE_TYPES,
    encode_frame,
    FrameDecoder,
    FrameError,
    validate_incoming_state,
)


class TestBackendProtocol(unittest.TestCase):
    def test_roundtrip_unicode_envelope(self):
        envelope = {
            "version": 1,
            "id": "py-msg-001",
            "type": "chat",
            "payload": {"text": "Olá do Python! 🚀 Caracteres especiais: ção, ã, é."}
        }
        frame = encode_frame(envelope)
        self.assertIsInstance(frame, bytes)
        declared_len = struct.unpack(">I", frame[:4])[0]
        self.assertEqual(declared_len, len(frame) - 4)

        decoder = FrameDecoder()
        messages = decoder.feed(frame)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0], envelope)

    def test_canonical_message_allowlists_match_host_contract(self):
        self.assertEqual(
            ALL_MESSAGE_TYPES,
            (
                "hello", "config", "chat", "audio_input", "interrupt", "memory_snapshot", "memory_clear", "shutdown",
                "hello_ack", "status", "user_transcript", "response", "audio_output", "tool_execution", "tool_result",
                "memory_upsert", "turn_complete", "interrupted", "error",
            ),
        )
        self.assertEqual(len(HOST_TO_SIDECAR_MESSAGE_TYPES), 8)
        self.assertEqual(len(SIDECAR_TO_HOST_MESSAGE_TYPES), 12)

    def test_accepts_valid_payload_for_every_allowed_message_type(self):
        payloads = {
            "hello": {"client": "test", "protocolVersion": 1},
            "config": {"agent_name": "Jasper", "model": "model", "voice": "voice", "apiKey": "", "vision": False},
            "chat": {"text": "oi"},
            "audio_input": {"audio_base64": "AA=="},
            "interrupt": {},
            "memory_snapshot": {"facts": []},
            "memory_clear": {},
            "shutdown": {"reason": "test"},
            "hello_ack": {"service": "jasper-backend", "protocolVersion": 1, "tools": []},
            "status": {"status": "ready"},
            "user_transcript": {"text": "oi"},
            "response": {"text": "olá"},
            "audio_output": {"audio_base64": "AA==", "format": "mp3", "text": "olá"},
            "tool_execution": {"tool": "test", "args": {}},
            "tool_result": {"tool": "test", "result": "ok"},
            "memory_upsert": {"facts": []},
            "turn_complete": {},
            "interrupted": {},
            "error": {"message": "erro"},
        }
        for message_type in ALL_MESSAGE_TYPES:
            envelope = {"version": 1, "id": f"valid-{message_type}", "type": message_type, "payload": payloads[message_type]}
            self.assertEqual(FrameDecoder().feed(encode_frame(envelope)), [envelope])

    def test_split_prefix(self):
        envelope = {
            "version": 1,
            "id": "split-pre",
            "type": "hello",
            "payload": {"client": "test", "protocolVersion": 1}
        }
        frame = encode_frame(envelope)
        decoder = FrameDecoder()

        self.assertEqual(decoder.feed(frame[:2]), [])
        self.assertEqual(decoder.feed(frame[2:4]), [])
        messages = decoder.feed(frame[4:])
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0], envelope)

    def test_split_body(self):
        envelope = {
            "version": 1,
            "id": "split-body",
            "type": "response",
            "payload": {"text": "A" * 5000}
        }
        frame = encode_frame(envelope)
        decoder = FrameDecoder()

        half = len(frame) // 2
        self.assertEqual(decoder.feed(frame[:half]), [])
        messages = decoder.feed(frame[half:])
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0], envelope)

    def test_coalesced_frames(self):
        env1 = {"version": 1, "id": "1", "type": "hello", "payload": {"client": "test", "protocolVersion": 1}}
        env2 = {"version": 1, "id": "2", "type": "status", "payload": {"status": "ok"}}
        combined = encode_frame(env1) + encode_frame(env2)

        decoder = FrameDecoder()
        messages = decoder.feed(combined)
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0], env1)
        self.assertEqual(messages[1], env2)

    def test_rejects_zero_length(self):
        decoder = FrameDecoder()
        with self.assertRaises(FrameError):
            decoder.feed(struct.pack(">I", 0))

    def test_rejects_oversized_length(self):
        decoder = FrameDecoder()
        with self.assertRaises(FrameError):
            decoder.feed(struct.pack(">I", 16777217))

    def test_rejects_invalid_json(self):
        body = b"{ not-json }"
        frame = struct.pack(">I", len(body)) + body
        decoder = FrameDecoder()
        with self.assertRaises(FrameError):
            decoder.feed(frame)

    def test_rejects_invalid_utf8(self):
        body = bytes([0xC3, 0x28])
        with self.assertRaises(FrameError):
            FrameDecoder().feed(struct.pack(">I", len(body)) + body)

    def test_rejects_unknown_and_wrong_direction_messages(self):
        unknown = {"version": 1, "id": "1", "type": "made_up", "payload": {}}
        with self.assertRaises(FrameError):
            encode_frame(unknown)

        host_only = {"version": 1, "id": "2", "type": "chat", "payload": {"text": "oi"}}
        with self.assertRaises(FrameError):
            FrameDecoder(allowed_types=SIDECAR_TO_HOST_MESSAGE_TYPES).feed(encode_frame(host_only))

    def test_rejects_missing_or_malformed_payloads(self):
        invalid_envelopes = (
            {"version": 1, "id": "1", "type": "hello"},
            {"version": 1, "id": "2", "type": "hello", "payload": {}},
            {"version": 1, "id": "3", "type": "chat", "payload": {"text": 123}},
            {"version": 1, "id": "4", "type": "audio_input", "payload": {"audio_base64": ""}},
            {"version": 1, "id": "5", "type": "config", "payload": {"model": "x"}},
            {"version": 1, "id": "6", "type": "hello_ack", "payload": {"protocolVersion": 1}},
            {"version": 1, "id": "7", "type": "status", "payload": {}},
            {"version": 1, "id": "8", "type": "response", "payload": {"text": False}},
            {"version": 1, "id": "9", "type": "tool_execution", "payload": {"tool": "x", "args": []}},
            {"version": 1, "id": "10", "type": "error", "payload": {}},
        )
        for envelope in invalid_envelopes:
            with self.subTest(message_type=envelope.get("type")):
                with self.assertRaises(FrameError):
                    encode_frame(envelope)

    def test_enforces_handshake_state(self):
        with self.assertRaises(FrameError):
            validate_incoming_state({"type": "chat"}, handshake_complete=False)
        with self.assertRaises(FrameError):
            validate_incoming_state({"type": "hello"}, handshake_complete=True)
        with self.assertRaises(FrameError):
            validate_incoming_state({"type": "response"}, handshake_complete=True)

    def test_rejects_version_mismatch(self):
        body = json.dumps({"version": 2, "id": "1", "type": "hello", "payload": {}}).encode("utf-8")
        frame = struct.pack(">I", len(body)) + body
        decoder = FrameDecoder()
        with self.assertRaises(FrameError):
            decoder.feed(frame)

    def test_rejects_id_or_type_limits(self):
        body = json.dumps({"version": 1, "id": "x" * 161, "type": "hello", "payload": {}}).encode("utf-8")
        frame = struct.pack(">I", len(body)) + body
        decoder = FrameDecoder()
        with self.assertRaises(FrameError):
            decoder.feed(frame)

    def test_rejects_chat_text_limits(self):
        body = json.dumps({"version": 1, "id": "1", "type": "chat", "payload": {"text": "y" * 20001}}).encode("utf-8")
        frame = struct.pack(">I", len(body)) + body
        decoder = FrameDecoder()
        with self.assertRaises(FrameError):
            decoder.feed(frame)


if __name__ == "__main__":
    unittest.main()
