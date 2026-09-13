"""
X-Whisper — ffmpeg Resolver

Finds the bundled ffmpeg.exe so we can decode mp3/mp4/m4a/ogg/flac/webm
into the 16 kHz mono WAV that whisper-cli expects.

We only bundle ffmpeg.exe (~180 MB) — duration probing is done by
running `ffmpeg -i <file>` and parsing the stderr banner, which saves
~180 MB by omitting ffprobe.exe.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_cached_path: Optional[Path] = None
_cache_primed: bool = False


def _binaries_root() -> Path:
    """
    PyInstaller freezes binaries under `sys._MEIPASS`; dev mode finds
    them at `<repo>/binaries/ffmpeg/`. Tauri bundle resources resolve
    via `<resource_dir>/_up_/binaries/ffmpeg/` — handled by the
    caller-provided override in ``X_WHISPER_FFMPEG_DIR`` when present.
    """
    override = os.environ.get("X_WHISPER_FFMPEG_DIR")
    if override:
        return Path(override)

    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "binaries" / "ffmpeg"

    # Walk up from this file until we find a `binaries/` sibling.
    here = Path(__file__).resolve().parent
    for candidate in [here, *here.parents]:
        probe = candidate / "binaries" / "ffmpeg"
        if probe.is_dir():
            return probe
    return here.parent / "binaries" / "ffmpeg"


def get_ffmpeg() -> Optional[Path]:
    """Return the absolute path to ffmpeg.exe, or None if not bundled."""
    global _cached_path, _cache_primed
    if _cache_primed:
        return _cached_path

    root = _binaries_root()
    candidate = root / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if candidate.is_file():
        _cached_path = candidate
        logger.info(f"ffmpeg resolved: {candidate}")
    else:
        _cached_path = None
        logger.warning(f"ffmpeg not found at {candidate}")

    _cache_primed = True
    return _cached_path


def is_available() -> bool:
    return get_ffmpeg() is not None
