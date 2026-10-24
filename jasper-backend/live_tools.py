"""Disposable tool processes: stopping a Live call terminates their process trees."""
import asyncio
import contextlib
import json
import os
import sys

from tools_os import AVAILABLE_FUNCTIONS, _minimal_subprocess_env, _terminate_process_tree


async def _run_worker(command, payload):
    process = await asyncio.create_subprocess_exec(
        *command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, env=_minimal_subprocess_env(),
        **({'creationflags': 0x08000000} if os.name == 'nt' else {}),
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(json.dumps(payload).encode('utf-8')), timeout=25)
        if process.returncode != 0:
            return {'error': 'A ferramenta não concluiu a operação.'}
        return json.loads(output.decode('utf-8'))
    finally:
        if process.returncode is None:
            if os.name == 'nt':
                with contextlib.suppress(Exception):
                    await asyncio.to_thread(_terminate_process_tree, process.pid)
            if process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
            await process.wait()


async def execute_live_tool(name, args):
    if name not in AVAILABLE_FUNCTIONS:
        return {'error': 'Ferramenta desconhecida.'}
    if getattr(sys, 'frozen', False):
        command = [sys.executable, '--live-tool-worker']
    else:
        command = [sys.executable, os.path.join(os.path.dirname(__file__), 'main.py'), '--live-tool-worker']
    return await _run_worker(command, {'name': name, 'args': args})


def worker_main():
    try:
        payload = json.loads(sys.stdin.buffer.read(1024 * 1024))
        name = payload['name']
        args = payload['args']
        if name not in AVAILABLE_FUNCTIONS or not isinstance(args, dict):
            return 1
        result = AVAILABLE_FUNCTIONS[name](**args)
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=True).encode('utf-8'))
        sys.stdout.buffer.flush()
        return 0
    except Exception:
        return 1
