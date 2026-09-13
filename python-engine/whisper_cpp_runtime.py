"""
X-Whisper — whisper.cpp Binary Runtime Manager

Resolves the correct `whisper-cli` binary for the host GPU. The
installer (or a dev checkout) ships one folder per backend under
`binaries/whisper-cpp/`; this module picks the right one, verifies
it runs, and caches the decision in a sentinel file so subsequent
launches skip the probe.

Backend selection matrix:

    NVIDIA GPU present      → cuda    (fallback: cpu)
    AMD / Intel GPU present → vulkan  (fallback: cpu)
    No GPU detected         → cpu

Binary layout:

    <root>/binaries/whisper-cpp/
        cuda/   whisper-cli.exe  ggml-cuda.dll  cudnn_*.dll
        vulkan/ whisper-cli.exe  ggml-vulkan.dll
        cpu/    whisper-cli.exe

Where `<root>` is:
  * the repo root when running from source (dev loop);
  * `sys._MEIPASS` when running frozen under PyInstaller.

CPU is always shipped, so every fallback chain ends at cpu and
resolution cannot fail outright. If the preferred GPU backend's
binary is missing (e.g. user hasn't run the Vulkan build yet), the
resolver transparently steps down to cpu and writes that to the
sentinel — no error is surfaced to the caller.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import subprocess
import sys
from dataclasses import dataclass
from typing import Optional

from config import RUNTIME_DIR
from hardware import HardwareProfile, detect_profile
from subprocess_util import hidden_kwargs

logger = logging.getLogger(__name__)

SENTINEL_PATH = os.path.join(RUNTIME_DIR, "whisper_cpp_runtime.json")

# Bump when the resolution logic changes meaningfully so stale
# sentinels get re-probed.
CURRENT_SCHEMA = 2

BACKEND_CUDA = "cuda"
BACKEND_VULKAN = "vulkan"
BACKEND_METAL = "metal"
BACKEND_CPU = "cpu"

# Ordered fallback chain per host class. The first entry whose binary
# exists AND passes the health probe wins. CPU is terminal on every
# chain so resolution always produces a runnable binary.
_FALLBACK_CHAIN = {
    "nvidia": [BACKEND_CUDA, BACKEND_VULKAN, BACKEND_CPU],
    "amd":    [BACKEND_VULKAN, BACKEND_CPU],
    "intel":  [BACKEND_VULKAN, BACKEND_CPU],
    "apple":  [BACKEND_METAL, BACKEND_CPU],
    "other":  [BACKEND_CPU],
}


@dataclass(frozen=True)
class ResolvedRuntime:
    backend: str            # "cuda" | "vulkan" | "cpu"
    binary_path: str        # absolute path to whisper-cli(.exe)
    version: Optional[str]  # `whisper-cli --version` output, if we could read it


# ── Path resolution ──────────────────────────────────────────────────


def _binaries_root() -> str:
    """Folder that contains the `whisper-cpp/` subtree."""
    if getattr(sys, "frozen", False):
        # PyInstaller unpacks resources under _MEIPASS.
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    else:
        # Dev: this file is python-engine/whisper_cpp_runtime.py,
        # binaries live at <repo>/binaries/whisper-cpp/.
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "binaries", "whisper-cpp")


def _binary_name() -> str:
    return "whisper-cli.exe" if platform.system() == "Windows" else "whisper-cli"


def binary_path_for(backend: str) -> str:
    """Absolute path to the `whisper-cli` for a given backend (may not exist)."""
    return os.path.join(_binaries_root(), backend, _binary_name())


# ── Host classification ──────────────────────────────────────────────

# HardwareProfile.gpu_name only captures whatever torch / nvidia-smi
# sees — that's reliable for NVIDIA but blind to AMD and Intel GPUs
# on Windows. Fall back to wmic to enumerate every video controller.


def _windows_gpu_names() -> list[str]:
    """Enumerate every video controller on Windows via Get-CimInstance.
    Replaces the deprecated wmic, which is no longer shipped on Win11."""
    if platform.system() != "Windows":
        return []
    try:
        r = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            **hidden_kwargs(),
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return []
    if r.returncode != 0:
        return []
    return [ln.strip() for ln in (r.stdout or "").splitlines() if ln.strip()]


def _host_class(profile: HardwareProfile) -> str:
    """Map a HardwareProfile onto a fallback-chain key.

    NVIDIA detection is authoritative via torch/nvidia-smi; AMD and
    Intel need a wmic fallback because those drivers don't expose a
    CUDA device. Precedence: nvidia > amd > intel > other. A host
    with both NVIDIA and an AMD iGPU classes as nvidia so cuda is
    tried first.
    """
    if platform.system() == "Darwin":
        # Apple Silicon uses Metal. Intel Macs are unsupported in v1
        # and fall through to the cpu chain via "other".
        return "apple" if platform.machine() == "arm64" else "other"

    primary = (profile.gpu_name or "").lower()
    if profile.has_gpu and any(
        tok in primary for tok in ("nvidia", "geforce", "rtx", "gtx", "quadro", "tesla")
    ):
        return "nvidia"

    extra = [g.lower() for g in _windows_gpu_names()]
    if any("nvidia" in g or "geforce" in g for g in extra):
        return "nvidia"
    if any(("radeon" in g or " amd " in g or g.startswith("amd ")) for g in extra):
        return "amd"
    if any("intel" in g and ("arc" in g or "iris" in g or "uhd" in g or "hd graphics" in g) for g in extra):
        return "intel"
    return "other"


# ── Health probe ─────────────────────────────────────────────────────


def _probe_binary(path: str) -> Optional[str]:
    """Run `<binary> --help` with a short timeout. whisper-cli has no
    --version flag (confirmed against v1.8.4); --help exits 0 and
    prints a usage banner whose first line we use as a sentinel value.
    Returns the banner line on success, None on any failure."""
    if not os.path.isfile(path):
        return None
    try:
        proc = subprocess.run(
            [path, "--help"],
            capture_output=True,
            text=True,
            timeout=5,
            # Keep the backend DLLs (cuda/vulkan) next to the binary on
            # the search path.
            cwd=os.path.dirname(path),
            **hidden_kwargs(),
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        logger.debug(f"whisper-cli probe failed for {path}: {e}")
        return None
    out = (proc.stdout or proc.stderr or "").strip()
    if not out:
        logger.debug(f"whisper-cli at {path} produced no --help output")
        return None
    return out.splitlines()[0]


# ── Sentinel I/O ─────────────────────────────────────────────────────


def _read_sentinel() -> dict:
    try:
        with open(SENTINEL_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _write_sentinel(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(SENTINEL_PATH), exist_ok=True)
        with open(SENTINEL_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError as e:
        logger.debug(f"Could not write whisper_cpp sentinel: {e}")


# ── Public API ───────────────────────────────────────────────────────


def resolve(
    profile: Optional[HardwareProfile] = None,
    force: bool = False,
    preferred_backend: Optional[str] = None,
) -> ResolvedRuntime:
    """Pick a backend + binary for the current host. Cached across runs.

    `preferred_backend` jumps that backend to the head of the fallback
    chain — used by the provider for `device='cpu'` overrides and
    future "force Vulkan" settings. Unknown values are ignored.
    """
    profile = profile or detect_profile()
    host_class = _host_class(profile)

    # Preferred overrides skip the sentinel — each call re-probes so
    # the user isn't stuck on a stale cache after a settings change.
    if preferred_backend is None:
        sentinel = _read_sentinel()
        if (
            not force
            and sentinel.get("schema") == CURRENT_SCHEMA
            and sentinel.get("host_class") == host_class
        ):
            cached_backend = sentinel.get("backend")
            cached_path = sentinel.get("binary_path")
            if cached_backend and cached_path and os.path.isfile(cached_path):
                return ResolvedRuntime(
                    backend=cached_backend,
                    binary_path=cached_path,
                    version=sentinel.get("version"),
                )

    chain = list(_FALLBACK_CHAIN.get(host_class, _FALLBACK_CHAIN["other"]))
    if preferred_backend and preferred_backend in (BACKEND_CUDA, BACKEND_VULKAN, BACKEND_METAL, BACKEND_CPU):
        chain = [preferred_backend] + [b for b in chain if b != preferred_backend]
    last_error: Optional[str] = None
    for backend in chain:
        path = binary_path_for(backend)
        version = _probe_binary(path)
        if version is not None:
            logger.info(f"whisper.cpp runtime: backend={backend} binary={path}")
            # Only cache the host's default choice. Preferred-backend
            # overrides are one-offs (e.g. device='cpu' or a "force
            # Vulkan" toggle) and must not overwrite the sentinel.
            if preferred_backend is None:
                _write_sentinel(
                    {
                        "schema": CURRENT_SCHEMA,
                        "host_class": host_class,
                        "backend": backend,
                        "binary_path": path,
                        "version": version,
                    }
                )
            return ResolvedRuntime(backend=backend, binary_path=path, version=version)
        last_error = f"no working binary at {path}"
        logger.debug(last_error)

    # Every backend in the fallback chain failed — surface the CPU
    # path anyway so the caller can emit a precise error. The provider
    # will refuse to load until the binary is installed.
    fallback_path = binary_path_for(BACKEND_CPU)
    logger.warning(
        f"whisper.cpp runtime: no working backend found. "
        f"Expected {fallback_path}. Last error: {last_error}"
    )
    return ResolvedRuntime(backend=BACKEND_CPU, binary_path=fallback_path, version=None)


def is_installed() -> bool:
    """True iff the resolve() path points at a real file that probed OK."""
    runtime = resolve()
    return runtime.version is not None
