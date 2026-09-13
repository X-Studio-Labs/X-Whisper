"""
X-Whisper Python Engine — Shared Configuration
"""

import os
import platform

# ── WebSocket Server ──────────────────────────────────────────
WS_HOST = "localhost"
WS_PORT = 9876
WS_URI = f"ws://{WS_HOST}:{WS_PORT}"

# ── Audio Settings ────────────────────────────────────────────
SAMPLE_RATE = 16000
CHANNELS = 1
AUDIO_DTYPE = "float32"

# ── Model Catalog ─────────────────────────────────────────────
# X_MODELS lives in catalog.py (single source of truth). Legacy
# SUPPORTED_MODELS dict was removed in Phase 11.

# ── Paths ─────────────────────────────────────────────────────
def get_app_data_dir() -> str:
    """Get the platform-specific app data directory."""
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        return os.path.join(base, "X-Whisper")
    elif system == "Darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "X-Whisper")
    else:
        return os.path.join(os.path.expanduser("~"), ".config", "x-whisper")

APP_DATA_DIR = get_app_data_dir()
MODELS_DIR = os.path.join(APP_DATA_DIR, "models")
CONFIG_FILE = os.path.join(APP_DATA_DIR, "config.json")
TRANSCRIPTS_FILE = os.path.join(APP_DATA_DIR, "transcripts.json")
RUNTIME_DIR = os.path.join(APP_DATA_DIR, "runtime", "python")
LOGS_DIR = os.path.join(APP_DATA_DIR, "logs")
ENGINE_LOG_FILE = os.path.join(LOGS_DIR, "engine.log")

# Ensure directories exist
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

# ── Managed Python Runtime ─────────────────────────────────────
# X-Whisper ships an isolated Python 3.12 embeddable zip under
# RUNTIME_DIR so the engine is insulated from whatever Python the
# user has on PATH (including "none at all"). MANAGED_PYTHON_VERSION
# must stay within the wheel-support range of PyTorch + HF
# transformers + funasr — 3.9–3.13 today.
MANAGED_PYTHON_VERSION = "3.12.8"
MANAGED_PYTHON_EXE = os.path.join(
    RUNTIME_DIR,
    "python.exe" if platform.system() == "Windows" else "bin/python3.12",
)

# ── Logging ───────────────────────────────────────────────────
LOG_LEVEL = os.environ.get("X_WHISPER_LOG_LEVEL", "INFO")
