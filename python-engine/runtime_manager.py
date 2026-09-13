"""
X-Whisper — Managed Python Runtime Manager

Responsible for ensuring the engine runs under an isolated Python 3.12
installation in %APPDATA%/X-Whisper/runtime/python. Three entry points:

  - is_supported_python()   → True if the *current* interpreter can
                              host the full set of providers.
  - is_running_managed()    → True if sys.executable == managed python.
  - ensure_and_reexec()     → If the host Python is unsupported AND we
                              are not already on the managed runtime,
                              run bootstrap.ps1 (download + pip bootstrap)
                              and re-exec the current script under the
                              managed python.

Unsupported means: Python < 3.9 (too old for modern torch wheels) or
Python ≥ 3.14 (no wheels yet for torch/numpy/transformers). The
SUPPORTED_RANGE tuple is the single source of truth.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
import sys
from typing import Tuple

from config import MANAGED_PYTHON_EXE, RUNTIME_DIR
from subprocess_util import hidden_kwargs

logger = logging.getLogger(__name__)

SUPPORTED_MIN: Tuple[int, int] = (3, 9)
SUPPORTED_MAX_EXCLUSIVE: Tuple[int, int] = (3, 14)


def current_version_tuple() -> Tuple[int, int]:
    return (sys.version_info.major, sys.version_info.minor)


def is_supported_python() -> bool:
    v = current_version_tuple()
    return SUPPORTED_MIN <= v < SUPPORTED_MAX_EXCLUSIVE


def is_running_managed() -> bool:
    try:
        return os.path.normcase(os.path.realpath(sys.executable)) == os.path.normcase(
            os.path.realpath(MANAGED_PYTHON_EXE)
        )
    except OSError:
        return False


def managed_runtime_exists() -> bool:
    return os.path.exists(MANAGED_PYTHON_EXE)


def _bootstrap_script_path() -> str:
    engine_dir = os.path.dirname(os.path.abspath(__file__))
    if platform.system() == "Windows":
        return os.path.join(engine_dir, "bootstrap.ps1")
    return os.path.join(engine_dir, "bootstrap.sh")


def _requirements_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")


def run_bootstrap() -> int:
    """Invoke the platform bootstrap script synchronously; return its exit code."""
    script = _bootstrap_script_path()
    if platform.system() == "Windows":
        cmd = [
            "powershell",
            "-ExecutionPolicy", "Bypass",
            "-File", script,
            "-RuntimeDir", RUNTIME_DIR,
            "-RequirementsFile", _requirements_path(),
        ]
    else:
        cmd = [
            "bash", script,
            "-RuntimeDir", RUNTIME_DIR,
            "-RequirementsFile", _requirements_path(),
        ]
    logger.info(f"Running bootstrap: {' '.join(cmd)}")
    proc = subprocess.run(cmd, **hidden_kwargs())
    return proc.returncode


def ensure_and_reexec() -> None:
    """
    If the current interpreter is unsupported, run the bootstrap (if
    needed) and re-launch the engine under the managed Python. This
    function does not return on the unsupported path — it replaces the
    current process or exits with a non-zero code.
    """
    if is_running_managed():
        return
    if is_supported_python():
        return

    v = current_version_tuple()
    logger.warning(
        f"Python {v[0]}.{v[1]} is outside the supported range "
        f"{SUPPORTED_MIN[0]}.{SUPPORTED_MIN[1]}–"
        f"{SUPPORTED_MAX_EXCLUSIVE[0]}.{SUPPORTED_MAX_EXCLUSIVE[1] - 1}. "
        f"Bootstrapping managed runtime…"
    )

    if not managed_runtime_exists():
        rc = run_bootstrap()
        if rc != 0:
            logger.error(f"Bootstrap failed with exit code {rc}. Cannot continue.")
            sys.exit(rc)

    # Re-exec the engine under the managed interpreter. On Windows
    # os.execv replaces the current process — Tauri's child handle
    # keeps tracking the new image automatically.
    logger.info(f"Re-execing under managed Python: {MANAGED_PYTHON_EXE}")
    main_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")
    try:
        os.execv(MANAGED_PYTHON_EXE, [MANAGED_PYTHON_EXE, main_py])
    except OSError as e:
        logger.error(f"execv failed: {e}")
        sys.exit(1)
