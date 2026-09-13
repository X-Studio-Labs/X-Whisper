"""
X-Whisper — Hardware Profile Detection

Phase 16. Produces a single `HardwareProfile` dataclass that captures
what the preset engine needs to pick a concrete model: total RAM,
CPU cores + frequency, GPU name + VRAM, and a coarse tier label.

The profile is computed on demand (cheap — psutil + a one-shot nvidia-smi
probe) and passed into `presets.resolve_preset(...)` whenever the user
changes preset or the engine warm-loads on first launch.

Design notes:
  * Never raises — every probe is wrapped. Missing torch / nvidia-smi
    returns `vram_gb=None` and `gpu_name=None` rather than blowing up.
  * Tier is an *opinion*, not a hard rule. `presets.py` is free to look
    at RAM / VRAM directly when resolving; the tier is mostly for UI.
  * Cross-platform: `psutil` + torch CUDA cover Windows, Linux, macOS.
    AMD / Intel iGPU detection is deliberately out of scope here.
"""

from __future__ import annotations

import logging
import platform
import subprocess
from dataclasses import asdict, dataclass
from typing import Optional

import psutil

from subprocess_util import hidden_kwargs

logger = logging.getLogger(__name__)

# ── Tier thresholds ──────────────────────────────────────────────────
# Chosen to match the X- catalog: the smallest `large-v3` variant
# needs ~6 GB RAM, so anything below 4 GB is "low", 4–8 GB "mid",
# 8–16 GB "high", 16+ "beast". VRAM, when available, upgrades the
# tier (a 2 GB CUDA GPU bumps a 4 GB box from low to mid).

TIER_LOW = "low"
TIER_MID = "mid"
TIER_HIGH = "high"
TIER_BEAST = "beast"


@dataclass(frozen=True)
class HardwareProfile:
    ram_gb: float
    available_ram_gb: float
    cpu_cores: int
    cpu_freq_mhz: Optional[float]
    gpu_name: Optional[str]
    vram_gb: Optional[float]
    has_gpu: bool
    tier: str
    platform: str

    def to_dict(self) -> dict:
        return asdict(self)


# ── GPU / VRAM probes ────────────────────────────────────────────────

def _detect_gpu_torch() -> tuple[Optional[str], Optional[float]]:
    """Try torch.cuda first — it's the only cross-vendor source we trust."""
    try:
        import torch  # type: ignore[import-not-found]
    except ImportError:
        return None, None

    try:
        if not torch.cuda.is_available():
            return None, None
        name = torch.cuda.get_device_name(0)
        props = torch.cuda.get_device_properties(0)
        vram_gb = round(props.total_memory / (1024 ** 3), 1)
        return name, vram_gb
    except Exception as e:
        logger.debug(f"torch CUDA probe failed: {e}")
        return None, None


def _detect_gpu_nvidia_smi() -> tuple[Optional[str], Optional[float]]:
    """Fallback when torch isn't importable (e.g. bootstrap hasn't run)."""
    if platform.system() != "Windows":
        return None, None
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            **hidden_kwargs(),
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None, None
        first = result.stdout.strip().split("\n")[0]
        parts = [p.strip() for p in first.split(",")]
        if len(parts) < 2:
            return None, None
        name = parts[0]
        vram_gb = round(float(parts[1]) / 1024, 1)  # nvidia-smi reports MiB
        return name, vram_gb
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError) as e:
        logger.debug(f"nvidia-smi probe failed: {e}")
        return None, None


def _detect_gpu() -> tuple[Optional[str], Optional[float]]:
    name, vram = _detect_gpu_torch()
    if name:
        return name, vram
    return _detect_gpu_nvidia_smi()


# ── Tier resolution ──────────────────────────────────────────────────

def _compute_tier(ram_gb: float, vram_gb: Optional[float]) -> str:
    # VRAM ≥ 8 GB on its own is enough to run large-v3 fast.
    if vram_gb is not None and vram_gb >= 8:
        return TIER_BEAST if ram_gb >= 16 else TIER_HIGH

    # A mid GPU (4–8 GB VRAM) bumps a mid-RAM box one tier up.
    gpu_bump = 1 if (vram_gb is not None and vram_gb >= 4) else 0

    if ram_gb < 4:
        base = 0
    elif ram_gb < 8:
        base = 1
    elif ram_gb < 16:
        base = 2
    else:
        base = 3

    final = min(base + gpu_bump, 3)
    return [TIER_LOW, TIER_MID, TIER_HIGH, TIER_BEAST][final]


# ── Public API ───────────────────────────────────────────────────────

def detect_profile() -> HardwareProfile:
    mem = psutil.virtual_memory()
    ram_gb = round(mem.total / (1024 ** 3), 1)
    available_gb = round(mem.available / (1024 ** 3), 1)

    cpu_cores = psutil.cpu_count(logical=True) or 0
    try:
        freq = psutil.cpu_freq()
        cpu_freq_mhz = round(freq.current, 0) if freq else None
    except Exception:
        cpu_freq_mhz = None

    gpu_name, vram_gb = _detect_gpu()
    tier = _compute_tier(ram_gb, vram_gb)

    return HardwareProfile(
        ram_gb=ram_gb,
        available_ram_gb=available_gb,
        cpu_cores=cpu_cores,
        cpu_freq_mhz=cpu_freq_mhz,
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        has_gpu=gpu_name is not None,
        tier=tier,
        platform=platform.system(),
    )
