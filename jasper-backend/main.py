import asyncio
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from protocol import FrameDecoder, FrameError, encode_frame
from runtime import JasperRuntime


async def main() -> int:
    runtime = JasperRuntime()
    decoder = FrameDecoder()
    write_lock = asyncio.Lock()
    read_fn = getattr(sys.stdin.buffer, "read1", sys.stdin.buffer.read)

    async def send_envelope(envelope: dict) -> None:
        raw_bytes = encode_frame(envelope)
        async with write_lock:
            sys.stdout.buffer.write(raw_bytes)
            sys.stdout.buffer.flush()

    while True:
        try:
            chunk = await asyncio.to_thread(read_fn, 65536)
        except Exception as read_err:
            print(f"[Main] Stdin read error: {read_err}", file=sys.stderr)
            return 1

        if not chunk:
            # EOF reached on stdin (parent process closed pipe)
            print("[Main] Stdin EOF received, exiting cleanly.", file=sys.stderr)
            return 0

        try:
            frames = decoder.push(chunk)
        except FrameError as frame_err:
            print(f"[Main] Protocol FrameError: {frame_err}", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"[Main] Unexpected decode error: {exc}", file=sys.stderr)
            return 1

        for frame in frames:
            msg_type = frame.get("type")
            try:
                async for reply in runtime.handle(frame):
                    await send_envelope(reply)
            except Exception as handler_err:
                print(f"[Main] Handler error for {msg_type}: {handler_err}", file=sys.stderr)

            if msg_type == "shutdown":
                print("[Main] Shutdown processed, terminating cleanly.", file=sys.stderr)
                return 0


if __name__ == "__main__":
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as fatal_err:
        print(f"[Main] Fatal error: {fatal_err}", file=sys.stderr)
        sys.exit(1)
