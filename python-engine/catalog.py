"""
X-Whisper — Model Catalog

Single source of truth for every supported model. Each entry is a
dict keyed by its X- ID with display name, provider, upstream repo,
size + RAM requirements, supported languages, and accuracy/speed
metrics (0.0 – 1.0).

The catalog is read by:
  - ModelManager.list_models() to surface the model picker to the UI
  - Preset engine (Phase 16) to resolve tier → concrete model
  - Legacy migration (Phase 17) to remap old config.json values
"""

from __future__ import annotations

# ── Language sets ────────────────────────────────────────────────────

# Whisper-family models support 99 languages plus `auto` for detection.
WHISPER_LANGUAGES: list[str] = [
    "auto",
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr",
    "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi",
    "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no",
    "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk",
    "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk",
    "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
    "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc",
    "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo",
    "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl",
    "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su",
]


# ── X_MODELS registry ────────────────────────────────────────────────

X_MODELS: dict[str, dict] = {
    # ── Whisper.cpp (GGML) family ─────────────────────────────────
    # Every local model routes through whisper.cpp for universal GPU
    # support (NVIDIA / AMD / Intel / Apple). `ggml_file` is the
    # release asset name under ggerganov/whisper.cpp; `quantization`
    # is f16 (canonical) unless otherwise noted.
    "x-large-v3": {
        "display": "X-Large v3",
        "provider": "whisper_cpp",
        "repo": "ggerganov/whisper.cpp",
        "ggml_file": "ggml-large-v3.bin",
        "quantization": "f16",
        "size_mb": 2947,
        "min_ram_gb": 6,
        "gpu_preferred": True,
        "languages": WHISPER_LANGUAGES,
        "accuracy": 0.96,
        "speed": 0.60,
        "requires_extra_deps": [],
        "requires_network": False,
    },
    "x-turbo": {
        "display": "X-Turbo",
        "provider": "whisper_cpp",
        "repo": "ggerganov/whisper.cpp",
        "ggml_file": "ggml-large-v3-turbo.bin",
        "quantization": "f16",
        "size_mb": 1624,
        "min_ram_gb": 4,
        "gpu_preferred": True,
        "languages": WHISPER_LANGUAGES,
        "accuracy": 0.90,
        "speed": 0.90,
        "requires_extra_deps": [],
        "requires_network": False,
    },
    "x-medium-en": {
        "display": "X-Medium EN",
        "provider": "whisper_cpp",
        "repo": "ggerganov/whisper.cpp",
        "ggml_file": "ggml-medium.en.bin",
        "quantization": "f16",
        "size_mb": 1464,
        "min_ram_gb": 3,
        "gpu_preferred": False,
        "languages": ["en"],
        "accuracy": 0.85,
        "speed": 0.85,
        "requires_extra_deps": [],
        "requires_network": False,
    },
    "x-small-en": {
        "display": "X-Small EN",
        "provider": "whisper_cpp",
        "repo": "ggerganov/whisper.cpp",
        "ggml_file": "ggml-small.en.bin",
        "quantization": "f16",
        "size_mb": 466,
        "min_ram_gb": 2,
        "gpu_preferred": False,
        "languages": ["en"],
        "accuracy": 0.75,
        "speed": 0.95,
        "requires_extra_deps": [],
        "requires_network": False,
    },

    # ── Groq Cloud family ─────────────────────────────────────────
    "x-turbo-cloud": {
        "display": "X-Turbo Cloud",
        "provider": "groq",
        "repo": "whisper-large-v3-turbo",
        "size_mb": 0,
        "min_ram_gb": 0,
        "gpu_preferred": False,
        "languages": WHISPER_LANGUAGES,
        "accuracy": 0.92,
        "speed": 0.99,
        "requires_extra_deps": [],
        "requires_network": True,
    },
    "x-pro-cloud": {
        "display": "X-Pro Cloud",
        "provider": "groq",
        "repo": "whisper-large-v3",
        "size_mb": 0,
        "min_ram_gb": 0,
        "gpu_preferred": False,
        "languages": WHISPER_LANGUAGES,
        "accuracy": 0.96,
        "speed": 0.95,
        "requires_extra_deps": [],
        "requires_network": True,
    },
}


# ── Legacy migration map ─────────────────────────────────────────────

# Used by Phase 17 to remap existing config.json entries. Maps old
# faster-whisper names (tiny, base, small, medium, large-v2, large-v3)
# to their closest X- counterpart.
LEGACY_MODEL_MIGRATION: dict[str, str] = {
    "tiny":      "x-small-en",
    "tiny.en":   "x-small-en",
    "base":      "x-small-en",
    "base.en":   "x-small-en",
    "small":     "x-small-en",
    "small.en":  "x-small-en",
    "medium":    "x-medium-en",
    "medium.en": "x-medium-en",
    "large-v1":  "x-large-v3",
    "large-v2":  "x-large-v3",
    "large-v3":  "x-large-v3",
    "large":     "x-large-v3",
    # Pre-whisper.cpp-migration X-IDs. x-large-v3-5 collapsed into
    # x-large-v3 because distil-v3.5 has no upstream GGML file.
    "x-large-v3-5": "x-large-v3",
}


# ── Helpers ──────────────────────────────────────────────────────────


def get_model(model_id: str) -> dict | None:
    """Look up a model by its X- ID. Returns the raw dict or None."""
    return X_MODELS.get(model_id)


def list_models() -> list[dict]:
    """Return every X_MODELS entry with its ID attached as `id`."""
    return [{"id": mid, **info} for mid, info in X_MODELS.items()]


def models_for_provider(provider: str) -> list[dict]:
    """Filter catalog by provider name (whisper_cpp, groq)."""
    return [
        {"id": mid, **info}
        for mid, info in X_MODELS.items()
        if info["provider"] == provider
    ]


def migrate_legacy_id(model_id: str) -> str:
    """
    Convert a legacy Whisper model ID to its X- equivalent.
    Returns the input unchanged if it is already an X- ID or unknown.
    """
    if model_id in X_MODELS:
        return model_id
    return LEGACY_MODEL_MIGRATION.get(model_id, model_id)


def is_legacy_id(model_id: str) -> bool:
    """True if the given ID is a pre-overhaul Whisper model name."""
    return model_id in LEGACY_MODEL_MIGRATION and model_id not in X_MODELS


def provider_names() -> list[str]:
    """All distinct provider names present in the catalog."""
    return sorted({info["provider"] for info in X_MODELS.values()})
