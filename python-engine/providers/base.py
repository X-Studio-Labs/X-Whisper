"""
X-Whisper — Base Provider Interface

Abstract contract for all transcription backends. Every provider
(whisper.cpp, Groq) subclasses BaseProvider and implements the same
load/transcribe/unload surface so the rest of the engine can treat
them uniformly.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Optional

import numpy as np


# ── Result / Option dataclasses ──────────────────────────────────────


@dataclass
class LoadResult:
    """Returned by BaseProvider.load()."""
    success: bool
    model_id: str
    device: str = "cpu"
    compute_type: str = "int8"
    error: Optional[str] = None
    message: Optional[str] = None


@dataclass
class TranscribeOptions:
    """Knobs passed to a transcribe() or stream_transcribe() call."""
    language: Optional[str] = None  # None or "auto" = auto-detect
    beam_size: int = 1
    vad_filter: bool = True
    temperature: float = 0.0
    initial_prompt: Optional[str] = None


@dataclass
class TranscribeResult:
    """Final output of a transcribe() call."""
    success: bool
    text: str = ""
    srt: Optional[str] = None
    language: Optional[str] = None
    language_probability: Optional[float] = None
    duration: Optional[float] = None
    error: Optional[str] = None
    message: Optional[str] = None


# Progress callback shape for long file transcriptions.
# Called from a worker thread. Signature: (percent: float 0–100).
ProgressCallback = Callable[[float], None]


@dataclass
class PartialResult:
    """Yielded by stream_transcribe() as the audio rolls in."""
    text: str
    is_final: bool
    segment_id: int
    language: Optional[str] = None


# ── Exceptions ───────────────────────────────────────────────────────


class ProviderNotAvailableError(Exception):
    """
    Raised when a provider's required dependencies are not installed.
    With the current catalog (Whisper + Groq only) every provider's deps
    ship in the baseline `requirements.txt`, so this is defensive — kept
    so future opt-in providers can re-use the same error shape.
    """

    def __init__(self, provider_name: str, missing_deps: list[str], message: str = ""):
        self.provider_name = provider_name
        self.missing_deps = missing_deps
        super().__init__(message or f"{provider_name} requires: {', '.join(missing_deps)}")


# ── Abstract base ────────────────────────────────────────────────────


class BaseProvider(ABC):
    """
    All transcription backends implement this interface.

    Subclasses must implement: load, transcribe, unload, is_loaded, current_model.
    stream_transcribe has a default fallback that batches everything into
    a single transcribe() call; real streaming providers override it.
    """

    # ── Mandatory surface ─────────────────────────────────────────

    @abstractmethod
    def load(
        self,
        model_id: str,
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
    ) -> LoadResult:
        """Load a model into memory. Called synchronously — caller
        is responsible for running in a thread pool if needed."""

    @abstractmethod
    def transcribe(self, audio: np.ndarray, options: TranscribeOptions) -> TranscribeResult:
        """Transcribe a complete audio buffer (float32 @ 16 kHz mono)."""

    @abstractmethod
    def unload(self) -> None:
        """Free memory held by the loaded model."""

    @property
    @abstractmethod
    def is_loaded(self) -> bool:
        """True when a model is currently in memory."""

    @property
    @abstractmethod
    def current_model(self) -> Optional[str]:
        """The X- ID of the currently loaded model, or None."""

    # ── Optional surface (defaults provided) ──────────────────────

    async def stream_transcribe(
        self,
        chunks: AsyncIterator[np.ndarray],
        options: TranscribeOptions,
    ) -> AsyncIterator[PartialResult]:
        """
        Stream partial transcripts as chunks arrive. Default
        implementation concatenates all chunks and emits a single
        final result. Phase 14 wires real streaming per-provider.
        """
        buffers: list[np.ndarray] = []
        async for chunk in chunks:
            buffers.append(chunk)

        if not buffers:
            yield PartialResult(text="", is_final=True, segment_id=0)
            return

        full = np.concatenate(buffers, axis=0) if len(buffers) > 1 else buffers[0]
        result = self.transcribe(full, options)
        yield PartialResult(
            text=result.text,
            is_final=True,
            segment_id=0,
            language=result.language,
        )

    # ── Metadata (overridden by subclasses via class attributes) ──

    provider_name: str = "base"
    requires_network: bool = False
    requires_extra_deps: list[str] = field(default_factory=list)
    supports_streaming: bool = True  # Rolling re-transcribe works by default;
    # cloud providers with per-call cost override to False.

    # File-transcription hooks (Phase 19). Providers that can accept a
    # native audio/video file path (mp3/mp4/etc) directly set
    # accepts_file_directly=True. Otherwise the caller decodes via
    # ffmpeg first and passes a 16 kHz WAV — the provider's
    # transcribe_file() implementation can assume it'll receive a WAV
    # in that case.
    accepts_file_directly: bool = False

    def transcribe_file(
        self,
        path: str,
        options: TranscribeOptions,
        progress_cb: Optional[ProgressCallback] = None,
        *,
        want_srt: bool = False,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> TranscribeResult:
        """
        Transcribe an audio/video file from disk. Default implementation
        routes through in-memory numpy — providers that want progress
        reporting or native file upload should override.

        - `path` is an absolute path on disk.
        - `progress_cb(percent)` may be called periodically; ignore in
          default impl since `transcribe(np.ndarray)` has no progress.
        - `want_srt` asks for an SRT string on the result.
        - `is_cancelled()` returns True when the caller aborted; the
          provider should bail ASAP.
        """
        _ = progress_cb, want_srt, is_cancelled  # default impl ignores these
        import wave

        try:
            with wave.open(path, "rb") as wav:
                if wav.getframerate() != 16000 or wav.getnchannels() != 1:
                    return TranscribeResult(
                        success=False,
                        error="bad_audio_format",
                        message=(
                            "Default transcribe_file expects 16 kHz mono WAV. "
                            "The caller should run ffmpeg first."
                        ),
                    )
                frames = wav.readframes(wav.getnframes())
                pcm16 = np.frombuffer(frames, dtype=np.int16)
                audio = pcm16.astype(np.float32) / 32768.0
        except Exception as e:  # noqa: BLE001
            return TranscribeResult(
                success=False,
                error="file_read_failed",
                message=f"Could not read WAV: {e}",
            )

        return self.transcribe(audio, options)

    def supports_live_partials(self) -> bool:
        """Finer-grained gate asked by StreamingCoordinator on the
        currently-loaded model/backend combo. Default: mirror the
        class-level flag. Providers override this when some combos
        (e.g. CPU + 500 MB model) can't keep up with the streaming
        cadence and would just back up the queue."""
        return self.supports_streaming

    def get_status(self) -> dict:
        """Diagnostics snapshot for the Settings About pane."""
        return {
            "provider": self.provider_name,
            "loaded": self.is_loaded,
            "model": self.current_model,
            "requires_network": self.requires_network,
            "requires_extra_deps": list(self.requires_extra_deps),
        }
