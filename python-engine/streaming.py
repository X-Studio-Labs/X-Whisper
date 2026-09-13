"""
X-Whisper — Streaming Transcription Coordinator

Polls the live `AudioCapture.buffer` at a fixed cadence while a
recording is in progress, re-transcribes the growing tail, and emits
`partial_transcript` events over the WebSocket. Works with any
`BaseProvider` that advertises `supports_streaming=True`.

This is rolling re-transcribe, not token-by-token streaming: we run
`provider.transcribe(window, …)` on an overlapping window of the
audio every `interval_ms` while the user is speaking. Cheap enough
for Whisper-family and funasr; explicitly disabled for Groq.

The coordinator is launched from `main.py.start_recording` and
cancelled on `stop_recording` (after which the caller's final
transcribe emits the authoritative `transcript` event).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import numpy as np

from audio_capture import AudioCapture
from providers import registry
from providers.base import BaseProvider, TranscribeOptions
from config import SAMPLE_RATE

logger = logging.getLogger(__name__)


class StreamingCoordinator:
    """Drives periodic partial transcripts while recording is active."""

    def __init__(
        self,
        audio: AudioCapture,
        options: TranscribeOptions,
        interval_ms: int = 2000,
        min_buffer_sec: float = 1.5,
        max_window_sec: float = 30.0,
    ):
        self._audio = audio
        self._options = options
        self._interval = max(interval_ms, 500) / 1000.0
        self._min_buffer_sec = max(min_buffer_sec, 0.5)
        self._max_window_sec = max(max_window_sec, 5.0)

        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        self._last_text: str = ""
        self._segment_id: int = 0

    # ── Lifecycle ────────────────────────────────────────────────

    async def start(self, send_event) -> None:
        """Kick off the polling task. `send_event` is an awaitable
        callable accepting a dict payload."""
        if self._task is not None:
            logger.warning("Streaming already running — ignoring start")
            return

        provider = registry.get_active()
        if provider is None or not provider.is_loaded:
            logger.info("Streaming: no provider loaded, skipping")
            return
        if not provider.supports_streaming:
            logger.info(
                f"Streaming: provider {provider.provider_name} opted out — "
                f"skipping live partials"
            )
            return
        if not provider.supports_live_partials():
            # Finer-grained gate — e.g. whisper.cpp on a CPU backend
            # where each poll takes longer than the cadence. The final
            # transcribe on stop_recording still fires; users just
            # won't see live partials.
            logger.info(
                f"Streaming: {provider.provider_name} "
                f"({provider.current_model}) can't sustain live partials "
                f"on the current backend — skipping"
            )
            return

        self._stopping = False
        self._task = asyncio.create_task(self._run(provider, send_event))
        logger.info(
            f"Streaming started: interval={self._interval:.1f}s, "
            f"window=[{self._min_buffer_sec:.1f}s, {self._max_window_sec:.1f}s]"
        )

    async def stop(self) -> None:
        self._stopping = True
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"Streaming task ended with error: {e}")
        finally:
            self._task = None
            logger.info("Streaming stopped")

    # ── Polling loop ─────────────────────────────────────────────

    async def _run(self, provider: BaseProvider, send_event) -> None:
        loop = asyncio.get_event_loop()
        try:
            while not self._stopping and self._audio.recording:
                await asyncio.sleep(self._interval)

                if self._stopping or not self._audio.recording:
                    break

                if self._audio.buffered_seconds < self._min_buffer_sec:
                    continue

                window = self._take_window()
                if window is None or window.size == 0:
                    continue

                try:
                    result = await loop.run_in_executor(
                        None,
                        lambda w=window: provider.transcribe(w, self._options),
                    )
                except Exception as e:
                    logger.warning(f"Streaming transcribe failed: {e}")
                    continue

                if not result.success or not result.text:
                    continue

                text = result.text.strip()
                if not text or text == self._last_text:
                    continue
                self._last_text = text
                self._segment_id += 1

                await send_event({
                    "event": "partial_transcript",
                    "text": text,
                    "is_final": False,
                    "segment_id": self._segment_id,
                    "language": result.language,
                })
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"Streaming loop crashed: {e}")

    def _take_window(self) -> Optional[np.ndarray]:
        """Slice the trailing `max_window_sec` of the capture buffer."""
        audio = self._audio.peek_audio()
        if audio is None:
            return None
        max_samples = int(self._max_window_sec * SAMPLE_RATE)
        if len(audio) > max_samples:
            return audio[-max_samples:]
        return audio
