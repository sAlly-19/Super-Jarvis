import unittest
import struct
import json
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Will be implemented in Step 3
try:
    from protocol import encode_frame, FrameDecoder, FrameError
except ImportError:
    encode_frame = None
    FrameDecoder = None
    FrameError = Exception


class TestBackendProtocol(unittest.TestCase):
    def setUp(self):
        if FrameDecoder is None:
            self.skipTest("Módulo protocol.py ainda não implementado")

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

    def test_split_prefix(self):
        envelope = {
            "version": 1,
            "id": "split-pre",
            "type": "hello",
            "payload": {"capabilities": ["os_tools"]}
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
        env1 = {"version": 1, "id": "1", "type": "hello", "payload": {}}
        env2 = {"version": 1, "id": "2", "type": "status", "payload": {"state": "ok"}}
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
