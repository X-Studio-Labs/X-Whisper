"""
X-Whisper — Provider Registry

Single active-provider holder. Routes model IDs to their implementing
provider class based on `catalog.X_MODELS[<id>]["provider"]`.

Local STT runs through WhisperCppProvider (GGML + whisper-cli, universal
GPU support); cloud STT runs through GroqProvider.
"""

from __future__ import annotations

import logging
from typing import Optional

from catalog import get_model

from .base import BaseProvider, LoadResult, ProviderNotAvailableError
from .groq_provider import GroqProvider
from .whisper_cpp_provider import WhisperCppProvider

logger = logging.getLogger(__name__)


# ── Provider class table ────────────────────────────────────────────

_PROVIDER_CLASSES: dict[str, type[BaseProvider]] = {
    "whisper_cpp":  WhisperCppProvider,
    "groq":         GroqProvider,
}


# ── Active-provider state ────────────────────────────────────────────

_active: Optional[BaseProvider] = None


def get_active() -> Optional[BaseProvider]:
    """Return the currently-loaded provider instance, or None."""
    return _active


def is_provider_wired(provider_name: str) -> bool:
    """True when the given provider name has an implementation registered."""
    return provider_name in _PROVIDER_CLASSES


def load(
    model_id: str,
    device: Optional[str] = None,
    compute_type: Optional[str] = None,
) -> LoadResult:
    """
    Load `model_id`. Instantiates the matching provider class. If a
    different provider class is currently active, it's unloaded first.
    """
    global _active

    meta = get_model(model_id)
    if meta is None:
        return LoadResult(
            success=False,
            model_id=model_id,
            error="unknown_model",
            message=f"Unknown model '{model_id}' — not in catalog.",
        )

    provider_cls = _PROVIDER_CLASSES.get(meta["provider"])
    if provider_cls is None:
        return LoadResult(
            success=False,
            model_id=model_id,
            error="provider_not_implemented",
            message=(
                f"Provider '{meta['provider']}' is defined in the catalog "
                f"but not yet wired up. It arrives in a later phase."
            ),
        )

    if _active is not None and not isinstance(_active, provider_cls):
        logger.info(f"Switching providers — unloading {_active.provider_name}")
        _active.unload()
        _active = None

    if _active is None:
        _active = provider_cls()

    try:
        return _active.load(model_id, device=device, compute_type=compute_type)
    except ProviderNotAvailableError as e:
        logger.warning(f"Provider {e.provider_name} missing deps: {e.missing_deps}")
        # Drop the half-constructed provider so the next load can re-try.
        _active = None
        return LoadResult(
            success=False,
            model_id=model_id,
            error="extra_deps_required",
            message=str(e),
        )


def unload() -> None:
    """Unload whatever is active. Safe to call when nothing is loaded."""
    global _active
    if _active is not None:
        _active.unload()
        _active = None


def get_status() -> dict:
    """
    Diagnostics for the Settings About pane / engine status command.
    Mirrors the old WhisperEngine.get_status() shape for back-compat
    while adding provider info.
    """
    if _active is None:
        return {
            "loaded": False,
            "model": None,
            "device": None,
            "compute_type": None,
            "provider": None,
        }
    base = _active.get_status()
    device = getattr(_active, "_device", None)
    compute_type = getattr(_active, "_compute_type", None)
    return {
        "loaded": base["loaded"],
        "model": base["model"],
        "device": device,
        "compute_type": compute_type,
        "provider": base["provider"],
        "requires_network": base["requires_network"],
    }
