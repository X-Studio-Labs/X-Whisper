"""
X-Whisper — subprocess helpers

Tauri launches the engine as a windows-subsystem process, but every
child we spawn (whisper-cli, ffmpeg, powershell, nvidia-smi…) would
otherwise inherit a visible console and flash a terminal on each call.
`hidden_kwargs()` returns the creationflags / startupinfo kwargs that
suppress those flashes on Windows, and is a no-op elsewhere.
"""

from __future__ import annotations

import os
import subprocess
from typing import Any, Dict

# CREATE_NO_WINDOW is defined in the Windows API headers; mirror it here so
# we don't depend on subprocess.CREATE_NO_WINDOW being present on other OSes.
_CREATE_NO_WINDOW = 0x08000000


def hidden_kwargs() -> Dict[str, Any]:
    """Kwargs for subprocess.run / Popen to suppress a console flash on Windows."""
    if os.name != "nt":
        return {}
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return {
        "creationflags": _CREATE_NO_WINDOW,
        "startupinfo": si,
    }
