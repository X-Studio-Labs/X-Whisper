"""
X-Whisper — Preset Engine

Phase 16. Maps a preset name + a hardware profile + the current offline /
cloud-availability flags onto a concrete model ID + device + compute-type
+ beam-size tuple. The settings store already persists `preset` — this
module is the resolver that turns that string into an actual load plan.

Preset names (kept in sync with `settings_store.DEFAULTS['preset']`):
  * instant       — smallest / fastest model that still transcribes.
                    Picks English-only distil models when we know they'll
                    fit the hardware.
  * balanced      — the default. Picks the best quality model that fits
                    the hardware comfortably (leaves a RAM headroom).
  * accurate      — largest local model the hardware can run, even if
                    slow. Falls back one tier if VRAM is too tight.
  * turbo_cloud   — Groq-backed; resolves to `x-turbo-cloud` as long as
                    cloud is available and offline-only is off.
  * custom        — user picked something explicitly; the resolver
                    returns whatever is currently saved in settings.model
                    unchanged, so the caller should skip re-resolving.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from catalog import X_MODELS, get_model
from hardware import HardwareProfile, TIER_BEAST, TIER_HIGH, TIER_MID, TIER_LOW

logger = logging.getLogger(__name__)


# ── Types ────────────────────────────────────────────────────────────

PresetName = str  # 'instant' | 'balanced' | 'accurate' | 'turbo_cloud' | 'custom'

KNOWN_PRESETS: tuple[str, ...] = (
    "instant",
    "balanced",
    "accurate",
    "turbo_cloud",
    "custom",
)


@dataclass(frozen=True)
class ResolvedPreset:
    preset: str
    model_id: str
    device: str          # 'cuda' | 'cpu'
    compute_type: str    # 'float16' | 'int8' | 'int8_float16'
    beam_size: int
    reason: str          # Short human string for the UI tooltip.


# ── Tier → local model ID tables ─────────────────────────────────────
# Each table is ordered best-to-worst within the tier; the resolver
# picks the first entry whose `min_ram_gb` the profile can satisfy.

_INSTANT_BY_TIER: dict[str, list[str]] = {
    TIER_LOW:   ["x-small-en"],
    TIER_MID:   ["x-small-en", "x-medium-en"],
    TIER_HIGH:  ["x-medium-en", "x-small-en"],
    TIER_BEAST: ["x-medium-en", "x-turbo"],
}

_BALANCED_BY_TIER: dict[str, list[str]] = {
    TIER_LOW:   ["x-small-en"],
    TIER_MID:   ["x-medium-en", "x-small-en"],
    TIER_HIGH:  ["x-turbo", "x-medium-en"],
    TIER_BEAST: ["x-turbo", "x-large-v3"],
}

_ACCURATE_BY_TIER: dict[str, list[str]] = {
    TIER_LOW:   ["x-small-en"],
    TIER_MID:   ["x-medium-en", "x-small-en"],
    TIER_HIGH:  ["x-large-v3", "x-turbo", "x-medium-en"],
    TIER_BEAST: ["x-large-v3", "x-turbo"],
}


# ── Resolution ───────────────────────────────────────────────────────

def _pick_first_fitting(
    candidates: list[str],
    profile: HardwareProfile,
) -> Optional[str]:
    """Return the first model ID whose min_ram_gb ≤ profile.ram_gb."""
    for model_id in candidates:
        meta = get_model(model_id)
        if meta is None:
            continue
        min_ram = meta.get("min_ram_gb", 0)
        if profile.ram_gb + 0.5 >= min_ram:  # 0.5 GB slack for rounding
            return model_id
    return None


def _device_and_compute(
    model_id: str,
    profile: HardwareProfile,
) -> tuple[str, str]:
    """
    Choose device + compute type for a given model. GPU path uses
    float16 when there's ≥4 GB VRAM, int8_float16 otherwise. CPU path
    always uses int8.
    """
    meta = get_model(model_id) or {}
    gpu_preferred = meta.get("gpu_preferred", False)

    if gpu_preferred and profile.has_gpu and profile.vram_gb and profile.vram_gb >= 4:
        compute = "float16"
        return "cuda", compute

    if gpu_preferred and profile.has_gpu:
        return "cuda", "int8_float16"

    return "cpu", "int8"


def _resolve_local(
    preset: str,
    profile: HardwareProfile,
) -> ResolvedPreset:
    """Pick a local model for instant / balanced / accurate."""
    table = {
        "instant": _INSTANT_BY_TIER,
        "balanced": _BALANCED_BY_TIER,
        "accurate": _ACCURATE_BY_TIER,
    }[preset]

    candidates = table.get(profile.tier, table[TIER_MID])
    model_id = _pick_first_fitting(candidates, profile)

    # Absolute fallback — x-small-en needs only 2 GB RAM.
    if model_id is None:
        model_id = "x-small-en"

    device, compute = _device_and_compute(model_id, profile)
    beam_size = 5 if preset == "accurate" and device == "cuda" else 1

    gpu_hint = f", {profile.vram_gb}GB VRAM" if profile.vram_gb else ""
    reason = (
        f"{preset.capitalize()} preset on {profile.tier} tier "
        f"({profile.ram_gb}GB RAM{gpu_hint})"
    )
    return ResolvedPreset(
        preset=preset,
        model_id=model_id,
        device=device,
        compute_type=compute,
        beam_size=beam_size,
        reason=reason,
    )


def resolve_preset(
    preset: str,
    profile: HardwareProfile,
    offline_only: bool = False,
    cloud_available: bool = False,
    custom_model_id: Optional[str] = None,
) -> ResolvedPreset:
    """
    Resolve a preset name + hardware profile onto a concrete load plan.

    Semantics:
      * custom: returns whatever is stored in `custom_model_id` unchanged.
      * turbo_cloud: returns `x-turbo-cloud` when cloud is usable,
        otherwise falls back to balanced-local.
      * instant / balanced / accurate: picks the best local model that
        fits the tier using the tables above.
    """
    if preset not in KNOWN_PRESETS:
        logger.warning(f"Unknown preset '{preset}', falling back to balanced")
        preset = "balanced"

    if preset == "custom":
        model_id = custom_model_id or "x-turbo"
        device, compute = _device_and_compute(model_id, profile)
        return ResolvedPreset(
            preset="custom",
            model_id=model_id,
            device=device,
            compute_type=compute,
            beam_size=1,
            reason="Custom — user-selected model",
        )

    if preset == "turbo_cloud":
        if offline_only:
            logger.info("turbo_cloud requested but offline_only=True — falling back to balanced")
            fallback = _resolve_local("balanced", profile)
            return ResolvedPreset(
                preset=fallback.preset,
                model_id=fallback.model_id,
                device=fallback.device,
                compute_type=fallback.compute_type,
                beam_size=fallback.beam_size,
                reason="Offline-only is on — resolved balanced instead of turbo_cloud",
            )
        if not cloud_available:
            fallback = _resolve_local("balanced", profile)
            return ResolvedPreset(
                preset=fallback.preset,
                model_id=fallback.model_id,
                device=fallback.device,
                compute_type=fallback.compute_type,
                beam_size=fallback.beam_size,
                reason="Cloud unavailable — resolved balanced instead of turbo_cloud",
            )
        return ResolvedPreset(
            preset="turbo_cloud",
            model_id="x-turbo-cloud",
            device="cloud",
            compute_type="cloud",
            beam_size=1,
            reason="Turbo Cloud — Groq-backed, low-latency",
        )

    return _resolve_local(preset, profile)


# ── Catalog helper for UI ────────────────────────────────────────────

def preset_catalog(
    profile: HardwareProfile,
    offline_only: bool = False,
    cloud_available: bool = False,
    custom_model_id: Optional[str] = None,
) -> list[dict]:
    """
    Return one entry per user-visible preset with the concrete model each
    would resolve to *right now*. The UI renders this as a row of tiles.
    `custom` is excluded here — the UI lights it up implicitly whenever
    the user picks a model by hand.
    """
    out = []
    for name in ("instant", "balanced", "accurate", "turbo_cloud"):
        resolved = resolve_preset(
            name,
            profile,
            offline_only=offline_only,
            cloud_available=cloud_available,
            custom_model_id=custom_model_id,
        )
        meta = get_model(resolved.model_id) or {}
        out.append({
            "preset": name,
            "model_id": resolved.model_id,
            "display": meta.get("display", resolved.model_id),
            "provider": meta.get("provider", ""),
            "device": resolved.device,
            "compute_type": resolved.compute_type,
            "beam_size": resolved.beam_size,
            "requires_network": meta.get("requires_network", False),
            "reason": resolved.reason,
            "available": (
                name != "turbo_cloud"
                or (cloud_available and not offline_only)
            ),
        })
    return out
