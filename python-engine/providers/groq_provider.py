"""
X-Whisper — Groq Cloud Provider

Routes x-turbo-cloud and x-pro-cloud through Groq's HTTPS
transcription API. "Loading" this provider means instantiating the
SDK client with a stored API key — there is nothing to download, and
the model runs entirely on Groq's infrastructure.
"""

from __future__ import annotations

import io
import logging
import os
import wave
from typing import Callable, Optional

import numpy as np

from catalog import get_model
from api_keys import get_key

from .base import (
    BaseProvider,
    LoadResult,
    ProgressCallback,
    ProviderNotAvailableError,
    TranscribeOptions,
    TranscribeResult,
)

logger = logging.getLogger(__name__)

GROQ_KEY_NAME = "groq_api_key"


class GroqProvider(BaseProvider):
    """Backs x-turbo-cloud and x-pro-cloud via Groq API."""

    provider_name = "groq"
    requires_network = True
    requires_extra_deps: list[str] = []
    # Streaming would mean hammering the paid API every interval; leave
    # the user in charge of when to call by disabling live partials.
    supports_streaming = False
    # Groq's /audio/transcriptions accepts mp3/m4a/mp4/etc directly, so
    # Phase 19 can upload the original file bytes and skip the ffmpeg
    # decode that whisper.cpp requires.
    accepts_file_directly = True

    def __init__(self):
        self._client = None
        self._model_id: Optional[str] = None
        self._repo: Optional[str] = None

    # ── Properties ────────────────────────────────────────────────

    @property
    def is_loaded(self) -> bool:
        return self._client is not None

    @property
    def current_model(self) -> Optional[str]:
        return self._model_id

    # ── Load / Unload ─────────────────────────────────────────────

    def load(
        self,
        model_id: str,
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
    ) -> LoadResult:
        meta = get_model(model_id)
        if meta is None:
            return LoadResult(
                success=False,
                model_id=model_id,
                error="unknown_model",
                message=f"Unknown model '{model_id}' — not in catalog.",
            )

        if meta["provider"] != self.provider_name:
            return LoadResult(
                success=False,
                model_id=model_id,
                error="wrong_provider",
                message=(
                    f"{model_id} belongs to provider {meta['provider']!r}, "
                    f"not {self.provider_name!r}."
                ),
            )

        if self._client is not None and self._model_id == model_id:
            logger.info(f"Groq client already primed for {model_id} — no-op")
            return LoadResult(
                success=True,
                model_id=model_id,
                device="cloud",
                compute_type="api",
            )

        api_key = get_key(GROQ_KEY_NAME)
        if not api_key:
            return LoadResult(
                success=False,
                model_id=model_id,
                error="missing_api_key",
                message=(
                    "Groq API key not set. Add one under Settings → Cloud."
                ),
            )

        try:
            from groq import Groq
        except ImportError as e:
            raise ProviderNotAvailableError(
                self.provider_name,
                ["groq"],
                f"groq SDK not installed: {e}",
            )

        try:
            self._client = Groq(api_key=api_key)
        except Exception as e:
            logger.error(f"Groq client init failed: {e}")
            return LoadResult(
                success=False,
                model_id=model_id,
                error="client_init_failed",
                message=str(e),
            )

        self._model_id = model_id
        self._repo = meta["repo"]
        logger.info(f"Groq client ready for {model_id} ({self._repo})")

        return LoadResult(
            success=True,
            model_id=model_id,
            device="cloud",
            compute_type="api",
        )

    def unload(self) -> None:
        if self._client is None:
            return
        prev = self._model_id
        self._client = None
        self._model_id = None
        self._repo = None
        logger.info(f"Dropped Groq client for {prev}")

    # ── Transcribe ────────────────────────────────────────────────

    def transcribe(self, audio: np.ndarray, options: TranscribeOptions) -> TranscribeResult:
        if self._client is None or self._repo is None:
            return TranscribeResult(
                success=False,
                error="no_model",
                message="No Groq model loaded.",
            )

        wav_bytes = self._to_wav(audio)
        lang = options.language if options.language and options.language != "auto" else None

        params: dict = {
            "file": ("audio.wav", wav_bytes),
            "model": self._repo,
            "response_format": "verbose_json",
            "temperature": options.temperature,
        }
        if lang:
            params["language"] = lang
        if options.initial_prompt:
            params["prompt"] = options.initial_prompt

        try:
            duration_s = len(audio) / 16000
            logger.info(
                f"Groq transcribe: {duration_s:.1f}s via {self._repo} "
                f"lang={lang or 'auto'}"
            )
            result = self._client.audio.transcriptions.create(**params)
            text = (getattr(result, "text", "") or "").strip()
            language = getattr(result, "language", None)
            duration = getattr(result, "duration", None)
            logger.info(f"Groq transcribe complete: text='{text[:80]}...'")
            return TranscribeResult(
                success=True,
                text=text,
                language=language,
                language_probability=None,
                duration=round(duration, 1) if duration else round(duration_s, 1),
            )
        except Exception as e:
            return self._classify_error(e)

    # ── File transcription (Phase 19) ─────────────────────────────

    def transcribe_file(
        self,
        path: str,
        options: TranscribeOptions,
        progress_cb: Optional[ProgressCallback] = None,
        *,
        want_srt: bool = False,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> TranscribeResult:
        """Upload the file bytes directly to Groq. Groq accepts mp3,
        mp4, m4a, ogg, flac, wav, webm — no local transcode needed."""
        if self._client is None or self._repo is None:
            return TranscribeResult(
                success=False, error="no_model", message="No Groq model loaded."
            )
        if not os.path.isfile(path):
            return TranscribeResult(
                success=False,
                error="file_not_found",
                message=f"File not found: {path}",
            )

        if is_cancelled and is_cancelled():
            return TranscribeResult(
                success=False, error="cancelled", message="Cancelled by user."
            )

        try:
            with open(path, "rb") as fh:
                file_bytes = fh.read()
        except OSError as e:
            return TranscribeResult(
                success=False,
                error="file_read_failed",
                message=f"Could not read file: {e}",
            )

        if progress_cb is not None:
            try:
                progress_cb(10.0)
            except Exception:  # noqa: BLE001
                pass

        filename = os.path.basename(path) or "audio.bin"
        lang = options.language if options.language and options.language != "auto" else None

        params: dict = {
            "file": (filename, file_bytes),
            "model": self._repo,
            # verbose_json gives us segments for SRT; plain json would
            # only expose `text`.
            "response_format": "verbose_json",
            "temperature": options.temperature,
        }
        if lang:
            params["language"] = lang
        if options.initial_prompt:
            params["prompt"] = options.initial_prompt

        size_mb = len(file_bytes) / (1024 * 1024)
        logger.info(
            f"Groq file transcribe: {filename} ({size_mb:.1f} MB) "
            f"via {self._repo} lang={lang or 'auto'} want_srt={want_srt}"
        )

        try:
            result = self._client.audio.transcriptions.create(**params)
        except Exception as e:
            return self._classify_error(e)

        if is_cancelled and is_cancelled():
            return TranscribeResult(
                success=False, error="cancelled", message="Cancelled by user."
            )

        text = (getattr(result, "text", "") or "").strip()
        language = getattr(result, "language", None)
        duration = getattr(result, "duration", None)

        srt_str: Optional[str] = None
        if want_srt:
            segments = getattr(result, "segments", None) or []
            if segments:
                srt_str = self._segments_to_srt(segments)

        if progress_cb is not None:
            try:
                progress_cb(100.0)
            except Exception:  # noqa: BLE001
                pass

        logger.info(
            f"Groq file transcribe complete: {len(text)} chars, "
            f"lang={language}"
        )
        return TranscribeResult(
            success=True,
            text=text,
            srt=srt_str,
            language=language,
            language_probability=None,
            duration=round(duration, 1) if duration else None,
        )

    @staticmethod
    def _segments_to_srt(segments) -> str:
        def ts(t) -> str:
            if t is None:
                t = 0.0
            total_ms = int(round(float(t) * 1000))
            h, rem = divmod(total_ms, 3_600_000)
            m, rem = divmod(rem, 60_000)
            s, ms = divmod(rem, 1000)
            return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

        def _get(seg, key):
            return seg.get(key) if isinstance(seg, dict) else getattr(seg, key, None)

        lines: list[str] = []
        idx = 1
        for seg in segments:
            text = (_get(seg, "text") or "").strip()
            if not text:
                continue
            start = _get(seg, "start")
            end = _get(seg, "end")
            lines.append(str(idx))
            lines.append(f"{ts(start)} --> {ts(end)}")
            lines.append(text)
            lines.append("")
            idx += 1
        return "\n".join(lines)

    # ── Key test ──────────────────────────────────────────────────

    @staticmethod
    def test_api_key(api_key: str) -> dict:
        """Probe the Groq API with a candidate key by listing models."""
        if not api_key:
            return {"ok": False, "error": "missing_api_key", "message": "No key provided."}
        try:
            from groq import Groq
        except ImportError as e:
            return {
                "ok": False,
                "error": "groq_not_installed",
                "message": f"groq SDK not installed: {e}",
            }
        try:
            client = Groq(api_key=api_key)
            models = client.models.list()
            names = [m.id for m in getattr(models, "data", [])]
            return {"ok": True, "models": names}
        except Exception as e:
            err = str(e).lower()
            if "unauthor" in err or "invalid" in err or "api_key" in err:
                return {"ok": False, "error": "invalid_api_key", "message": str(e)}
            if "network" in err or "connection" in err or "timeout" in err:
                return {"ok": False, "error": "network_error", "message": str(e)}
            return {"ok": False, "error": "unknown_error", "message": str(e)}

    # ── Helpers ───────────────────────────────────────────────────

    @staticmethod
    def _to_wav(audio: np.ndarray, sample_rate: int = 16000) -> bytes:
        """Encode float32 [-1, 1] mono audio to 16-bit PCM WAV bytes."""
        clipped = np.clip(audio, -1.0, 1.0)
        pcm16 = (clipped * 32767.0).astype(np.int16)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(pcm16.tobytes())
        return buf.getvalue()

    @staticmethod
    def _classify_error(e: Exception) -> TranscribeResult:
        msg = str(e)
        err = msg.lower()
        if "unauthor" in err or "invalid" in err or "api_key" in err:
            return TranscribeResult(
                success=False,
                error="invalid_api_key",
                message="Groq API key is invalid or expired.",
            )
        if "rate" in err and "limit" in err:
            return TranscribeResult(
                success=False,
                error="rate_limited",
                message="Groq rate limit hit. Try again in a moment.",
            )
        if "network" in err or "connection" in err or "timeout" in err or "dns" in err:
            return TranscribeResult(
                success=False,
                error="network_error",
                message=f"Cannot reach Groq: {msg}",
            )
        logger.error(f"Groq transcribe failed: {msg}")
        return TranscribeResult(
            success=False,
            error="transcription_failed",
            message=msg,
        )
