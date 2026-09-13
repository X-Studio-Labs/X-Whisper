"""
X-Whisper — File Transcribe Orchestrator

Phase 19. Wraps a single active file-transcription job on top of the
currently-loaded provider. One job at a time (sharing the same model),
cancellation is cooperative via an event the provider polls.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from providers import registry
from providers.base import TranscribeOptions, TranscribeResult

logger = logging.getLogger(__name__)


EventBroadcaster = Callable[[dict], Awaitable[None]]


@dataclass
class FileJob:
    job_id: str
    path: str
    filename: str
    want_srt: bool
    last_percent: float = 0.0


class FileTranscribeManager:
    """Owns the single active file-transcribe job, if any."""

    def __init__(self):
        self._active: Optional[FileJob] = None
        self._lock = threading.Lock()
        self._cancel = threading.Event()

    # ── State probes ──────────────────────────────────────────────

    @property
    def is_busy(self) -> bool:
        with self._lock:
            return self._active is not None

    def snapshot(self) -> Optional[dict]:
        """For diagnostics — the shape of the currently-running job."""
        with self._lock:
            if self._active is None:
                return None
            job = self._active
            return {
                "job_id": job.job_id,
                "path": job.path,
                "filename": job.filename,
                "want_srt": job.want_srt,
                "percent": job.last_percent,
            }

    # ── Cancellation ──────────────────────────────────────────────

    def cancel(self, job_id: Optional[str] = None) -> bool:
        """Signal the running job to abort. Returns True if a cancel
        was recorded (job was running and matched the id if provided)."""
        with self._lock:
            if self._active is None:
                return False
            if job_id and job_id != self._active.job_id:
                return False
            logger.info(f"Cancel requested for file job {self._active.job_id}")
            self._cancel.set()
            return True

    # ── Run ───────────────────────────────────────────────────────

    async def run(
        self,
        path: str,
        options: TranscribeOptions,
        want_srt: bool,
        broadcast: EventBroadcaster,
    ) -> dict:
        """Execute a file transcription end-to-end.

        Broadcasts file_transcribe_started / file_transcribe_progress /
        file_transcribe_complete. Returns the final payload as a dict
        so the caller can log / act on it.
        """
        provider = registry.get_active()
        if provider is None or not provider.is_loaded:
            return {
                "event": "file_transcribe_complete",
                "success": False,
                "error": "no_model",
                "message": "No model loaded. Load a model first.",
            }

        if not os.path.isfile(path):
            return {
                "event": "file_transcribe_complete",
                "success": False,
                "error": "file_not_found",
                "message": f"File not found: {path}",
            }

        # Claim the single job slot.
        with self._lock:
            if self._active is not None:
                return {
                    "event": "file_job_busy",
                    "success": False,
                    "error": "busy",
                    "message": "Another file is already being transcribed.",
                    "active_job_id": self._active.job_id,
                }
            job = FileJob(
                job_id=str(uuid.uuid4()),
                path=path,
                filename=os.path.basename(path) or "audio",
                want_srt=want_srt,
            )
            self._active = job
            self._cancel.clear()

        loop = asyncio.get_event_loop()

        def _progress_cb(pct: float) -> None:
            # Called from the executor thread; hop back onto the loop.
            job.last_percent = pct
            try:
                asyncio.run_coroutine_threadsafe(
                    broadcast({
                        "event": "file_transcribe_progress",
                        "job_id": job.job_id,
                        "percent": round(pct, 1),
                    }),
                    loop,
                )
            except RuntimeError:
                # Loop closed — user quit mid-job; ignore.
                pass

        def _is_cancelled() -> bool:
            return self._cancel.is_set()

        try:
            await broadcast({
                "event": "file_transcribe_started",
                "job_id": job.job_id,
                "filename": job.filename,
                "path": path,
                "provider": provider.provider_name,
                "model": provider.current_model,
                "want_srt": want_srt,
            })

            logger.info(
                f"file transcribe start job={job.job_id} file={job.filename} "
                f"provider={provider.provider_name} model={provider.current_model}"
            )

            result: TranscribeResult = await loop.run_in_executor(
                None,
                lambda: provider.transcribe_file(
                    path,
                    options,
                    progress_cb=_progress_cb,
                    want_srt=want_srt,
                    is_cancelled=_is_cancelled,
                ),
            )

            payload: dict = {
                "event": "file_transcribe_complete",
                "job_id": job.job_id,
                "filename": job.filename,
                "path": path,
                "success": bool(result.success),
                "text": result.text or "",
                "srt": result.srt,
                "language": result.language,
                "duration": result.duration,
                "provider": provider.provider_name,
                "model": provider.current_model,
                "cancelled": (result.error == "cancelled"),
                "error": result.error,
                "message": result.message,
            }

            if result.success:
                logger.info(
                    f"file transcribe done job={job.job_id} "
                    f"chars={len(result.text or '')} lang={result.language}"
                )
            else:
                logger.warning(
                    f"file transcribe failed job={job.job_id} "
                    f"code={result.error} msg={result.message}"
                )

            await broadcast(payload)
            return payload
        finally:
            with self._lock:
                self._active = None
                self._cancel.clear()
