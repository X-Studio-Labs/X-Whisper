"""
X-Whisper — Settings Persistence

Save and load user settings to/from config.json in AppData.
Also handles one-time migration of legacy model IDs (pre-Phase 11)
into their X- equivalents.
"""

import json
import logging
import os
import platform
import shutil
from typing import Any

from config import CONFIG_FILE, MODELS_DIR
from catalog import migrate_legacy_id, is_legacy_id, LEGACY_MODEL_MIGRATION

logger = logging.getLogger(__name__)


# ── Defaults ─────────────────────────────────────────────────────────

DEFAULTS: dict[str, Any] = {
    "hotkey": "Cmd+Shift+Space" if platform.system() == "Darwin" else "Ctrl+Shift+Space",
    "model": "x-turbo",            # Consumer default — multilingual, GPU-accelerated, real-time on any modern GPU
    "last_model": None,            # Warm-load target on next startup
    "language": "auto",
    "auto_paste": True,
    "beam_size": 1,
    "vad": True,
    "warm_load": True,             # Keep loaded model in RAM across idle periods
    "launch_at_startup": False,
    # Dynamic Island overlay: "always" | "speaking" (only while recording /
    # transcribing / showing a result) | "hidden". The island webview keeps
    # running when hidden — it hosts the hotkey + paste hooks.
    "island_visibility": "always",
    "max_recording_seconds": 120,
    "onboarding_completed": False,
    # Forward-looking defaults (filled in by later phases):
    "provider": "local",           # 'local' | 'cloud'
    "preset": "custom",            # Skip hardware-based preset resolution; honor settings.model as-is
    "offline_only": True,
    # Streaming / chunked inference (Phase 14)
    "streaming": True,             # Live partial transcripts while recording
    "stream_interval_ms": 2000,    # Re-transcribe cadence
    "stream_min_sec": 1.5,         # Skip transcripts until we have this much audio
    "stream_window_sec": 30.0,     # Trailing-window size for re-transcribe
    # Custom vocabulary — free-text prompt prefix biases recognition toward
    # user-supplied names / jargon. Passed straight to --prompt (whisper-cli)
    # or `prompt` (Groq). Hard-truncated server-side at INITIAL_PROMPT_MAX_CHARS.
    "initial_prompt": "",
    # Transcript history (v1.1) — persists up to 50 most recent successful
    # transcriptions to %APPDATA%/X-Whisper/transcripts.json. When turned
    # off the history file is deleted and new transcripts are not recorded.
    "save_history": True,
}

INITIAL_PROMPT_MAX_CHARS = 900  # whisper-cli's prompt context is ~224 tokens; cap chars conservatively


# ── Migration ────────────────────────────────────────────────────────

def _migrate(settings: dict) -> tuple[dict, bool]:
    """
    Upgrade a loaded settings dict in place. Returns (settings, changed)
    so the caller knows whether to write back to disk.
    """
    changed = False

    # Legacy key removed in Phase 11 — carried over from the old engine.
    if "unload_after_minutes" in settings:
        settings.pop("unload_after_minutes", None)
        changed = True

    # Legacy model ID → X- ID
    model = settings.get("model")
    if isinstance(model, str) and is_legacy_id(model):
        new_id = migrate_legacy_id(model)
        logger.info(f"Migrating legacy model '{model}' → '{new_id}'")
        settings["model"] = new_id
        changed = True

    last_model = settings.get("last_model")
    if isinstance(last_model, str) and is_legacy_id(last_model):
        new_id = migrate_legacy_id(last_model)
        logger.info(f"Migrating legacy last_model '{last_model}' → '{new_id}'")
        settings["last_model"] = new_id
        changed = True

    # One-time cleanup of legacy model directories on disk.
    if not settings.get("_legacy_models_cleaned"):
        _clean_legacy_model_dirs()
        settings["_legacy_models_cleaned"] = True
        changed = True

    return settings, changed


def _clean_legacy_model_dirs() -> None:
    """Remove on-disk model dirs whose names match pre-Phase-11 legacy IDs."""
    if not os.path.isdir(MODELS_DIR):
        return
    removed = []
    for legacy_name in LEGACY_MODEL_MIGRATION:
        legacy_dir = os.path.join(MODELS_DIR, legacy_name)
        if os.path.isdir(legacy_dir):
            try:
                shutil.rmtree(legacy_dir)
                removed.append(legacy_name)
            except OSError as e:
                logger.warning(f"Could not remove legacy model dir '{legacy_name}': {e}")
    if removed:
        logger.info(f"Cleaned legacy model directories: {', '.join(removed)}")


# ── Load / Save ──────────────────────────────────────────────────────

def load_settings() -> dict:
    """Load settings from config.json, merge over defaults, migrate."""
    settings = DEFAULTS.copy()

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            settings.update(saved)
            logger.info(f"Settings loaded from {CONFIG_FILE}")
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Failed to load settings: {e}. Using defaults.")
    else:
        logger.info("No config file found, writing defaults")
        save_settings(settings)

    settings, changed = _migrate(settings)
    if changed:
        save_settings(settings)

    return settings


def save_settings(settings: dict) -> bool:
    """Write the full settings dict to config.json."""
    try:
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
        logger.info(f"Settings saved to {CONFIG_FILE}")
        return True
    except IOError as e:
        logger.error(f"Failed to save settings: {e}")
        return False


def update_setting(key: str, value: Any) -> dict:
    """Update one key and save."""
    settings = load_settings()
    settings[key] = value
    save_settings(settings)
    return settings


def reset_settings() -> dict:
    """Restore defaults."""
    save_settings(DEFAULTS)
    return DEFAULTS.copy()
