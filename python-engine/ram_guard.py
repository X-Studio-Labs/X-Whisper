"""
X-Whisper — RAM Guard & System Info Detection

Phase 16. Delegates hardware probing to `hardware.detect_profile()` and
model recommendation to `presets.resolve_preset('balanced', …)`. The
shape of `get_system_info()` is kept backward-compatible (frontend reads
`total_ram_gb`, `available_ram_gb`, `gpu`, `recommended_model`) while
growing new fields: `vram_gb`, `hardware_tier`, `has_gpu`.
"""

import logging

import psutil

from hardware import detect_profile

logger = logging.getLogger(__name__)


class RAMGuard:
    """System info + memory safety checks."""

    @staticmethod
    def get_system_info() -> dict:
        profile = detect_profile()

        # Late import so a misconfigured catalog doesn't break system_info.
        from presets import resolve_preset
        from settings_store import load_settings
        from api_keys import get_key
        from providers.groq_provider import GROQ_KEY_NAME

        settings = load_settings()
        cloud_available = bool(get_key(GROQ_KEY_NAME))
        preset = settings.get("preset", "balanced")
        resolved = resolve_preset(
            preset,
            profile,
            offline_only=bool(settings.get("offline_only", False)),
            cloud_available=cloud_available,
            custom_model_id=settings.get("model"),
        )

        info = {
            # Back-compat keys used by the existing UI.
            "total_ram_gb": profile.ram_gb,
            "available_ram_gb": profile.available_ram_gb,
            "used_ram_gb": round(profile.ram_gb - profile.available_ram_gb, 1),
            "ram_percent": psutil.virtual_memory().percent,
            "cpu_count": profile.cpu_cores,
            "cpu_freq_mhz": profile.cpu_freq_mhz,
            "platform": profile.platform,
            "platform_version": __import__("platform").version(),
            "gpu": profile.gpu_name,
            "recommended_model": {
                "model": resolved.model_id,
                "compute_type": resolved.compute_type,
                "device": resolved.device,
                "beam_size": resolved.beam_size,
            },
            # Phase 16 additions.
            "has_gpu": profile.has_gpu,
            "vram_gb": profile.vram_gb,
            "hardware_tier": profile.tier,
            "preset": preset,
        }

        logger.info(
            f"System info: {profile.ram_gb}GB RAM, tier={profile.tier}, "
            f"GPU={profile.gpu_name}, VRAM={profile.vram_gb}, "
            f"preset={preset} → {resolved.model_id}"
        )
        return info

    @staticmethod
    def check_memory_safe(min_available_gb: float = 1.0) -> dict:
        """Check if there's enough memory to proceed with transcription."""
        available_gb = psutil.virtual_memory().available / (1024 ** 3)
        is_safe = available_gb >= min_available_gb
        return {
            "safe": is_safe,
            "available_gb": round(available_gb, 1),
            "message": (
                None
                if is_safe
                else f"Only {available_gb:.1f}GB RAM available. Close other apps and try again."
            ),
        }
