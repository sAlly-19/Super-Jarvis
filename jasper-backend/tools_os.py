import base64
import io
import json
import re
import subprocess
from typing import Any, Callable, Dict, List, Optional

import mss
import psutil
import pyautogui
from PIL import Image

# Configure PyAutoGUI for safe, low-latency desktop automation
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05

# Patterns blocked to prevent accidental OS destruction while allowing full utility automation
_DESTRUCTIVE_PATTERNS = [
    r"\bformat-volume\b",
    r"\bclear-disk\b",
    r"\bformat\s+[a-z]:",
    r"\bremove-item\b.*c:\\windows",
    r"\brd\s+/s\s+/q\s+c:\\windows",
    r"\bdel\s+/f\s+/s\s+/q\s+c:\\windows",
    r"\bcipher\s+/w:",
    r"\bbcdedit\b.*delete",
]


def _is_destructive_command(command: str) -> bool:
    normalized = (command or "").strip().lower()
    return any(re.search(pattern, normalized) for pattern in _DESTRUCTIVE_PATTERNS)


def run_powershell(command: str) -> str:
    """
    Executes PowerShell commands/scripts on Windows with a hidden window and 15s timeout.
    Used to open apps, manage files, control media, inspect network, etc.
    """
    if not command or not str(command).strip():
        return json.dumps({"status": "error", "error": "Comando PowerShell vazio."}, ensure_ascii=False)

    if _is_destructive_command(command):
        return json.dumps(
            {
                "status": "blocked",
                "error": "Comando bloqueado pela trava de segurança contra formatação/destruição do sistema operacional.",
            },
            ensure_ascii=False,
        )

    try:
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        wrapped_cmd = f"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {command}"
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                wrapped_cmd,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creation_flags,
            timeout=15,
        )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        if len(stdout) > 4000:
            stdout = stdout[:4000] + "\n...[saída truncada]"
        if len(stderr) > 2000:
            stderr = stderr[:2000] + "\n...[erro truncado]"

        return json.dumps(
            {
                "status": "ok" if completed.returncode == 0 else "error",
                "returncode": completed.returncode,
                "stdout": stdout,
                "stderr": stderr,
            },
            ensure_ascii=False,
        )
    except subprocess.TimeoutExpired:
        return json.dumps(
            {"status": "error", "error": "Timeout de 15 segundos atingido ao executar o comando PowerShell."},
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)


def get_system_telemetry() -> str:
    """
    Uses psutil to return CPU, RAM, Disk usage and the top 5 memory-consuming processes.
    """
    try:
        cpu_percent = psutil.cpu_percent(interval=0.15)
        vm = psutil.virtual_memory()
        disk = psutil.disk_usage("C:\\")

        processes: List[Dict[str, Any]] = []
        for proc in psutil.process_iter(["pid", "name", "memory_info"]):
            try:
                info = proc.info
                mem_info = info.get("memory_info")
                rss_mb = round((mem_info.rss / (1024 * 1024)), 1) if mem_info else 0.0
                processes.append(
                    {
                        "pid": info.get("pid"),
                        "name": info.get("name") or "unknown",
                        "memory_mb": rss_mb,
                    }
                )
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        top_5_processes = sorted(processes, key=lambda p: p["memory_mb"], reverse=True)[:5]

        telemetry = {
            "status": "ok",
            "cpu_percent": cpu_percent,
            "ram": {
                "percent": vm.percent,
                "used_gb": round(vm.used / (1024**3), 2),
                "total_gb": round(vm.total / (1024**3), 2),
                "available_gb": round(vm.available / (1024**3), 2),
            },
            "disk_c": {
                "percent": disk.percent,
                "used_gb": round(disk.used / (1024**3), 2),
                "total_gb": round(disk.total / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
            },
            "top_5_memory_processes": top_5_processes,
        }
        return json.dumps(telemetry, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)


def gui_action(
    action: str,
    x: Optional[int] = None,
    y: Optional[int] = None,
    text: Optional[str] = None,
) -> str:
    """
    Uses pyautogui to execute mouse and keyboard actions:
    click, double_click, right_click, move, type, hotkey.
    """
    act = (action or "").strip().lower()
    try:
        if act == "click":
            if x is not None and y is not None:
                pyautogui.click(x=int(x), y=int(y))
            else:
                pyautogui.click()
            return json.dumps({"status": "ok", "action": "click", "x": x, "y": y}, ensure_ascii=False)

        if act == "double_click":
            if x is not None and y is not None:
                pyautogui.doubleClick(x=int(x), y=int(y))
            else:
                pyautogui.doubleClick()
            return json.dumps({"status": "ok", "action": "double_click", "x": x, "y": y}, ensure_ascii=False)

        if act == "right_click":
            if x is not None and y is not None:
                pyautogui.rightClick(x=int(x), y=int(y))
            else:
                pyautogui.rightClick()
            return json.dumps({"status": "ok", "action": "right_click", "x": x, "y": y}, ensure_ascii=False)

        if act == "move":
            if x is None or y is None:
                return json.dumps(
                    {"status": "error", "error": "Coordenadas x e y são obrigatórias para action='move'."},
                    ensure_ascii=False,
                )
            pyautogui.moveTo(x=int(x), y=int(y), duration=0.12)
            return json.dumps({"status": "ok", "action": "move", "x": x, "y": y}, ensure_ascii=False)

        if act == "type":
            if not text:
                return json.dumps(
                    {"status": "error", "error": "O parâmetro 'text' é obrigatório para action='type'."},
                    ensure_ascii=False,
                )
            pyautogui.write(str(text), interval=0.01)
            return json.dumps({"status": "ok", "action": "type", "typed_length": len(str(text))}, ensure_ascii=False)

        if act == "hotkey":
            if not text:
                return json.dumps(
                    {"status": "error", "error": "Informe o atalho em 'text' (ex: 'ctrl+c', 'alt+tab', 'win+r')."},
                    ensure_ascii=False,
                )
            keys = [k.strip().lower() for k in str(text).split("+") if k.strip()]
            if not keys:
                return json.dumps({"status": "error", "error": "Atalho inválido."}, ensure_ascii=False)
            pyautogui.hotkey(*keys)
            return json.dumps({"status": "ok", "action": "hotkey", "keys": keys}, ensure_ascii=False)

        return json.dumps(
            {
                "status": "error",
                "error": f"Ação GUI desconhecida: '{action}'. Use click, double_click, right_click, move, type ou hotkey.",
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)


def control_system_volume(action: str = "get", level: Optional[int] = None) -> str:
    """
    Controls Windows master audio volume using pycaw and comtypes.
    Supported actions: 'get', 'set' (0-100), 'mute', 'unmute'.
    """
    act = (action or "get").strip().lower()
    try:
        import comtypes
        from ctypes import POINTER, cast
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

        comtypes.CoInitialize()
        try:
            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            volume = cast(interface, POINTER(IAudioEndpointVolume))

            if act == "set":
                if level is None:
                    return json.dumps(
                        {"status": "error", "error": "Informe 'level' entre 0 e 100 para ajustar o volume."},
                        ensure_ascii=False,
                    )
                clamped = max(0, min(100, int(level)))
                volume.SetMasterVolumeLevelScalar(clamped / 100.0, None)
                return json.dumps({"status": "ok", "action": "set", "volume_percent": clamped}, ensure_ascii=False)

            if act == "mute":
                volume.SetMute(1, None)
                return json.dumps({"status": "ok", "action": "mute", "muted": True}, ensure_ascii=False)

            if act == "unmute":
                volume.SetMute(0, None)
                return json.dumps({"status": "ok", "action": "unmute", "muted": False}, ensure_ascii=False)

            current_vol = round(float(volume.GetMasterVolumeLevelScalar()) * 100)
            is_muted = bool(volume.GetMute())
            return json.dumps(
                {"status": "ok", "action": "get", "volume_percent": current_vol, "muted": is_muted},
                ensure_ascii=False,
            )
        finally:
            try:
                comtypes.CoUninitialize()
            except Exception:
                pass
    except Exception as exc:
        return json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)


def capture_screen_base64() -> str:
    """
    Captures the primary monitor in ~5ms using mss, resizes to 1280x720 (JPEG 75%)
    with Pillow in memory, and returns the base64-encoded JPEG string.
    Includes fallback to PIL.ImageGrab and headless dark frame if BitBlt is unavailable.
    """
    img: Optional[Image.Image] = None
    try:
        with mss.mss() as sct:
            monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            raw_shot = sct.grab(monitor)
            img = Image.frombytes("RGB", raw_shot.size, raw_shot.bgra, "raw", "BGRX")
    except Exception:
        try:
            from PIL import ImageGrab

            img = ImageGrab.grab().convert("RGB")
        except Exception:
            img = Image.new("RGB", (1280, 720), (5, 5, 5))

    img = img.resize((1280, 720), Image.Resampling.BILINEAR)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=75, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


TOOLS_SCHEMA: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "run_powershell",
            "description": (
                "Executa comandos ou scripts PowerShell no Windows (oculto e com timeout de 15s) para abrir "
                "programas, gerenciar arquivos e pastas, controlar mídia, consultar rede, processos ou serviços."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Comando ou script PowerShell a ser executado.",
                    }
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_system_telemetry",
            "description": (
                "Retorna telemetria em tempo real do Windows: uso de CPU (%), memória RAM (GB/total), "
                "disco C: e os 5 processos que mais consomem memória."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gui_action",
            "description": (
                "Executa ações de mouse e teclado na interface gráfica do Windows via PyAutoGUI: "
                "click, double_click, right_click, move, type (digitar texto) e hotkey (ex: ctrl+c, alt+tab, win+r)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["click", "double_click", "right_click", "move", "type", "hotkey"],
                        "description": "Tipo da ação GUI.",
                    },
                    "x": {
                        "type": "integer",
                        "description": "Coordenada X na tela (opcional para cliques, obrigatório para move).",
                    },
                    "y": {
                        "type": "integer",
                        "description": "Coordenada Y na tela (opcional para cliques, obrigatório para move).",
                    },
                    "text": {
                        "type": "string",
                        "description": "Texto a digitar (para action='type') ou combinação de teclas separada por '+' (para action='hotkey', ex: 'ctrl+c', 'alt+tab', 'win+r').",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "control_system_volume",
            "description": "Controla ou consulta o volume mestre de áudio do Windows via Pycaw (get, set 0-100, mute, unmute).",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["get", "set", "mute", "unmute"],
                        "description": "Ação de controle de volume.",
                    },
                    "level": {
                        "type": "integer",
                        "description": "Nível de volume de 0 a 100 (usado quando action='set').",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "capture_screen_base64",
            "description": "Captura uma imagem em tempo real do monitor principal (1280x720 JPEG) para análise visual da tela.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]

AVAILABLE_FUNCTIONS: Dict[str, Callable[..., Any]] = {
    "run_powershell": run_powershell,
    "get_system_telemetry": get_system_telemetry,
    "gui_action": gui_action,
    "control_system_volume": control_system_volume,
    "capture_screen_base64": capture_screen_base64,
}
