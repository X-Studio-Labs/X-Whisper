"""
X-Whisper — whisper.cpp Provider

Backs every local Whisper model in the catalog by shelling out to the
bundled `whisper-cli` binary (GGML). Implements the BaseProvider
contract so the rest of the engine stays provider-agnostic.

Design:
  * No long-lived child process. `load()` validates the binary, the
    GGML file, and the model metadata; each `transcribe()` call spawns
    `whisper-cli`, pipes a temp WAV in, and reads the JSON output.
  * Streaming reuses BaseProvider's default rolling-window path via
    StreamingCoordinator — each poll is one spawn, which is cheap
    enough at our cadence (~80 ms on a mid laptop).
  * Binary + backend resolution is delegated to whisper_cpp_runtime.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import re
import subprocess
import tempfile
import threading
import time
import wave
from typing import Callable, Optional, Union

import numpy as np

from catalog import get_model
from config import MODELS_DIR, SAMPLE_RATE
from ram_guard import RAMGuard
from subprocess_util import hidden_kwargs
from whisper_cpp_runtime import ResolvedRuntime, binary_path_for, resolve

from .base import (
    BaseProvider,
    LoadResult,
    ProgressCallback,
    ProviderNotAvailableError,
    TranscribeOptions,
    TranscribeResult,
)

logger = logging.getLogger(__name__)


# Transcribes longer than this are almost certainly a runaway model or
# a stuck child process — kill and surface an error instead of hanging.
_TRANSCRIBE_TIMEOUT_SEC = 300


class WhisperCppProvider(BaseProvider):
    """Handles every catalog entry with `provider == 'whisper_cpp'`."""

    provider_name = "whisper_cpp"
    requires_network = False
    requires_extra_deps: list[str] = []
    supports_streaming = True

    def __init__(self):
        self._runtime: Optional[ResolvedRuntime] = None
        self._model_id: Optional[str] = None
        self._model_path: Optional[str] = None
        self._device: Optional[str] = None
        self._compute_type: Optional[str] = None
        self._cpu_threads: int = max(4, min((os.cpu_count() or 4) - 2, 8))
        # Serialise concurrent transcribe() calls. whisper-cli spawns a new
        # process each time and on macOS the Metal backend does not support
        # concurrent GPU contexts — a second whisper-cli starting while the
        # first still holds Metal resources causes an indefinite hang during
        # GPU memory querying (psutil + kernel memory pressure). The lock
        # ensures streaming partials and the final transcription never overlap.
        self._transcribe_lock = threading.Lock()

    # ── Properties ────────────────────────────────────────────────

    @property
    def is_loaded(self) -> bool:
        return self._runtime is not None and self._model_path is not None

    @property
    def current_model(self) -> Optional[str]:
        return self._model_id

    def supports_live_partials(self) -> bool:
        """Streaming is only viable when the per-poll cost fits inside
        the ~2 s streaming cadence. Benchmarked small.en at 4.7 s on
        CPU vs ~1.3 s on CUDA/Vulkan — so we gate CPU off. On a GPU
        backend every catalog model is within budget."""
        if self._runtime is None:
            return False
        return self._runtime.backend != "cpu"

    # ── Internals ─────────────────────────────────────────────────

    @staticmethod
    def _ggml_path(model_id: str, ggml_file: str) -> str:
        """Expected on-disk location of the GGML weights."""
        return os.path.join(MODELS_DIR, model_id, ggml_file)

    def _resolve_runtime(self, device_hint: Optional[str]) -> ResolvedRuntime:
        """Pick the right whisper-cli flavor. `device_hint='cpu'` forces
        the CPU binary even on a GPU host (used for small models where
        the GPU context load outweighs the speedup)."""
        if device_hint == "cpu":
            cpu_bin = binary_path_for("cpu")
            if os.path.isfile(cpu_bin):
                return ResolvedRuntime(backend="cpu", binary_path=cpu_bin, version=None)
        return resolve()

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

        ggml_file = meta.get("ggml_file")
        if not ggml_file:
            return LoadResult(
                success=False,
                model_id=model_id,
                error="catalog_missing_ggml_file",
                message=f"Catalog entry for {model_id} has no 'ggml_file'.",
            )

        model_path = self._ggml_path(model_id, ggml_file)
        if not os.path.isfile(model_path):
            return LoadResult(
                success=False,
                model_id=model_id,
                error="model_not_downloaded",
                message=(
                    f"GGML file not on disk: {model_path}. "
                    f"Download {model_id} first."
                ),
            )

        mem_check = RAMGuard.check_memory_safe(min_available_gb=1.5)
        if not mem_check["safe"]:
            return LoadResult(
                success=False,
                model_id=model_id,
                error="low_memory",
                message=mem_check["message"],
            )

        runtime = self._resolve_runtime(device)
        if not os.path.isfile(runtime.binary_path):
            raise ProviderNotAvailableError(
                self.provider_name,
                [f"whisper-cli ({runtime.backend})"],
                (
                    f"whisper-cli binary missing at {runtime.binary_path}. "
                    f"Reinstall or re-run bootstrap."
                ),
            )

        self._runtime = runtime
        self._model_id = model_id
        self._model_path = model_path
        self._device = runtime.backend  # "cuda" | "vulkan" | "cpu"
        self._compute_type = meta.get("quantization", "f16")

        # Eat cold-start costs up front so the first streaming poll
        # isn't the cold path. Vulkan shader compile alone is ~12 s on
        # first contact; CUDA kernel JIT and OS page cache warmup are
        # smaller but still user-visible.
        self._prewarm()

        # One banner per successful load, routed through the logger so
        # it also lands in engine.log (not just the Tauri stderr stream).
        # This is the canonical "which model is loaded on which backend"
        # record users go looking for.
        for line in (
            "============================================================",
            "  X-WHISPER ENGINE READY (whisper.cpp)",
            f"    model       = {model_id}",
            f"    backend     = {runtime.backend}",
            f"    quant       = {self._compute_type}",
            f"    cpu_threads = {self._cpu_threads}",
            f"    binary      = {runtime.binary_path}",
            "============================================================",
        ):
            logger.info(line)

        return LoadResult(
            success=True,
            model_id=model_id,
            device=runtime.backend,
            compute_type=self._compute_type,
        )

    def _prewarm(self) -> None:
        """Force the first (slow) inference to happen now, not on the
        user's first streaming poll. One-shot, best-effort: any error
        is logged and swallowed — load() still counts as successful."""
        if self._runtime is None:
            return
        import time as _time
        silence = np.zeros(SAMPLE_RATE, dtype=np.float32)  # 1 s of silence
        t0 = _time.perf_counter()
        try:
            result = self.transcribe(
                silence, TranscribeOptions(language="en", beam_size=1)
            )
        except Exception as e:
            logger.warning(f"prewarm failed (non-fatal): {e}")
            return
        dt_ms = (_time.perf_counter() - t0) * 1000
        logger.info(
            f"prewarm done in {dt_ms:.0f} ms "
            f"(backend={self._runtime.backend} ok={result.success})"
        )

    def unload(self) -> None:
        if self._runtime is None:
            return
        prev = self._model_id
        self._runtime = None
        self._model_id = None
        self._model_path = None
        self._device = None
        self._compute_type = None
        logger.info(f"Unloaded {prev}")

    # ── Transcribe ────────────────────────────────────────────────

    def transcribe(self, audio: np.ndarray, options: TranscribeOptions) -> TranscribeResult:
        if self._runtime is None or self._model_path is None:
            return TranscribeResult(
                success=False,
                error="no_model",
                message="No model loaded. Load a model first.",
            )

        with self._transcribe_lock:
            return self._transcribe_locked(audio, options)

    def _transcribe_locked(self, audio: np.ndarray, options: TranscribeOptions) -> TranscribeResult:
        mem_check = RAMGuard.check_memory_safe(min_available_gb=1.0)
        if not mem_check["safe"]:
            return TranscribeResult(
                success=False,
                error="low_memory",
                message=mem_check["message"],
            )

        with tempfile.TemporaryDirectory(prefix="xw-cpp-") as tmp:
            wav_path = os.path.join(tmp, "in.wav")
            self._write_wav(audio, wav_path)
            json_base = os.path.join(tmp, "out")  # whisper-cli writes <base>.json

            cmd = self._build_cmd(wav_path, json_base, options)
            logger.info(
                f"whisper-cli: {len(audio)} samples ({len(audio)/SAMPLE_RATE:.1f}s) "
                f"backend={self._runtime.backend}"
            )

            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=_TRANSCRIBE_TIMEOUT_SEC,
                    cwd=os.path.dirname(self._runtime.binary_path),
                    **hidden_kwargs(),
                )
            except subprocess.TimeoutExpired:
                logger.error(f"whisper-cli timed out after {_TRANSCRIBE_TIMEOUT_SEC}s")
                return TranscribeResult(
                    success=False,
                    error="transcribe_timeout",
                    message="Transcription exceeded timeout. Try a smaller model.",
                )
            except OSError as e:
                return TranscribeResult(
                    success=False,
                    error="spawn_failed",
                    message=f"Could not spawn whisper-cli: {e}",
                )

            if proc.returncode != 0:
                stderr = (proc.stderr or "").strip()
                low = stderr.lower()
                if "out of memory" in low or "cuda" in low and "oom" in low:
                    return TranscribeResult(
                        success=False,
                        error="cuda_oom",
                        message="GPU memory full. Try CPU mode or a smaller model.",
                    )
                logger.error(
                    f"whisper-cli exited {proc.returncode}: {stderr[:500]}"
                )
                return TranscribeResult(
                    success=False,
                    error="transcription_failed",
                    message=stderr or f"whisper-cli exit code {proc.returncode}",
                )

            json_path = json_base + ".json"
            return self._parse_json_output(json_path, len(audio))

    # ── Command construction ─────────────────────────────────────

    def _build_cmd(
        self,
        wav_path: str,
        json_base: str,
        options: TranscribeOptions,
    ) -> list[str]:
        assert self._runtime is not None and self._model_path is not None

        cmd: list[str] = [
            self._runtime.binary_path,
            "--model", self._model_path,
            "--file", wav_path,
            "--output-json",            # emit <json_base>.json
            "--output-file", json_base,
            "--threads", str(self._cpu_threads),
            "--beam-size", str(max(1, options.beam_size)),
            "--best-of", "1",
            "--no-timestamps",
            "--suppress-nst",           # non-speech tokens
            "--no-fallback",
        ]

        if options.temperature and options.temperature > 0:
            cmd += ["--temperature", f"{options.temperature}"]

        if options.language and options.language != "auto":
            cmd += ["--language", options.language]
        else:
            cmd += ["--language", "auto"]

        if options.initial_prompt:
            cmd += ["--prompt", options.initial_prompt]

        # CUDA / Vulkan binaries default to GPU; the CPU-only binary
        # ignores the flag. No explicit --gpu needed.
        return cmd

    # ── WAV encoding ─────────────────────────────────────────────

    @staticmethod
    def _write_wav(audio: np.ndarray, path: str) -> None:
        """Encode float32 [-1, 1] mono audio to 16-bit PCM WAV at 16 kHz."""
        clipped = np.clip(audio, -1.0, 1.0)
        pcm16 = (clipped * 32767.0).astype(np.int16)
        with wave.open(path, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(pcm16.tobytes())

    # ── JSON parsing ─────────────────────────────────────────────

    @staticmethod
    def _parse_json_output(json_path: str, audio_len_samples: int) -> TranscribeResult:
        if not os.path.isfile(json_path):
            return TranscribeResult(
                success=False,
                error="no_output",
                message=f"whisper-cli produced no JSON at {json_path}",
            )

        try:
            with open(json_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            return TranscribeResult(
                success=False,
                error="bad_json",
                message=f"Could not parse whisper-cli JSON: {e}",
            )

        # whisper-cli JSON schema:
        # {
        #   "systeminfo": "...",
        #   "model": {...},
        #   "params": {...},
        #   "result": { "language": "en" },
        #   "transcription": [
        #       { "timestamps": {...}, "offsets": {...}, "text": "..." },
        #       ...
        #   ]
        # }
        segs = payload.get("transcription", []) or []
        text = " ".join(
            (seg.get("text") or "").strip() for seg in segs if (seg.get("text") or "").strip()
        ).strip()

        result = payload.get("result", {}) or {}
        language = result.get("language")

        duration = round(audio_len_samples / SAMPLE_RATE, 1)

        logger.info(
            f"whisper-cli done: lang={language} "
            f"text='{text[:80]}{'…' if len(text) > 80 else ''}'"
        )

        return TranscribeResult(
            success=True,
            text=text,
            language=language,
            language_probability=None,  # whisper-cli doesn't expose this
            duration=duration,
        )

    # ── File transcription (Phase 19) ────────────────────────────

    _PROGRESS_RE = re.compile(r"progress\s*=\s*(\d+)")

    def transcribe_file(
        self,
        path: str,
        options: TranscribeOptions,
        progress_cb: Optional[ProgressCallback] = None,
        *,
        want_srt: bool = False,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> TranscribeResult:
        """Decode via ffmpeg (if needed) → whisper-cli with
        --print-progress → parse JSON + optional SRT. Cancellation is
        polled every ≤500 ms from a stderr drainer thread."""
        if self._runtime is None or self._model_path is None:
            return TranscribeResult(
                success=False,
                error="no_model",
                message="No model loaded. Load a model first.",
            )
        if not os.path.isfile(path):
            return TranscribeResult(
                success=False,
                error="file_not_found",
                message=f"File not found: {path}",
            )

        mem_check = RAMGuard.check_memory_safe(min_available_gb=1.0)
        if not mem_check["safe"]:
            return TranscribeResult(
                success=False,
                error="low_memory",
                message=mem_check["message"],
            )

        with tempfile.TemporaryDirectory(prefix="xw-file-") as tmp:
            wav = self._ensure_wav(path, tmp, is_cancelled)
            if isinstance(wav, TranscribeResult):
                return wav  # error / cancelled
            wav_path = wav

            duration_s = self._wav_duration(wav_path)
            output_base = os.path.join(tmp, "out")
            cmd = self._build_file_cmd(wav_path, output_base, options, want_srt)

            logger.info(
                f"whisper-cli file transcribe: {os.path.basename(path)} "
                f"({duration_s:.1f}s) backend={self._runtime.backend} "
                f"want_srt={want_srt}"
            )

            return self._run_whisper_file(
                cmd, output_base, duration_s, progress_cb, is_cancelled, want_srt
            )

    def _ensure_wav(
        self,
        path: str,
        tmp_dir: str,
        is_cancelled: Optional[Callable[[], bool]],
    ) -> Union[str, TranscribeResult]:
        """Return a path to a 16 kHz mono PCM WAV — either the input
        itself if it already matches, or a freshly-decoded temp file."""
        try:
            with wave.open(path, "rb") as w:
                if (
                    w.getframerate() == SAMPLE_RATE
                    and w.getnchannels() == 1
                    and w.getsampwidth() == 2
                ):
                    return path
        except (wave.Error, EOFError, OSError):
            pass  # not a plain WAV — fall through to ffmpeg decode

        from ffmpeg_runtime import get_ffmpeg

        ffmpeg_bin = get_ffmpeg()
        if ffmpeg_bin is None:
            return TranscribeResult(
                success=False,
                error="ffmpeg_missing",
                message=(
                    "ffmpeg is not bundled with this install. "
                    "Reinstall X-Whisper or drop an already-16kHz mono WAV."
                ),
            )

        out_wav = os.path.join(tmp_dir, "decoded.wav")
        cmd = [
            str(ffmpeg_bin),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            path,
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "wav",
            out_wav,
        ]
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                **hidden_kwargs(),
            )
        except OSError as e:
            return TranscribeResult(
                success=False,
                error="ffmpeg_spawn_failed",
                message=f"Could not spawn ffmpeg: {e}",
            )

        while proc.poll() is None:
            if is_cancelled and is_cancelled():
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                return TranscribeResult(
                    success=False, error="cancelled", message="Cancelled by user."
                )
            time.sleep(0.2)

        if proc.returncode != 0:
            err = ""
            try:
                err = (proc.stderr.read() or "").strip() if proc.stderr else ""
            except Exception:  # noqa: BLE001
                pass
            logger.error(f"ffmpeg decode failed (exit {proc.returncode}): {err[:500]}")
            return TranscribeResult(
                success=False,
                error="decode_failed",
                message=err or f"ffmpeg exited with code {proc.returncode}",
            )

        return out_wav

    @staticmethod
    def _wav_duration(wav_path: str) -> float:
        try:
            with wave.open(wav_path, "rb") as w:
                frames = w.getnframes()
                rate = w.getframerate() or SAMPLE_RATE
                return frames / rate
        except (wave.Error, EOFError, OSError):
            return 0.0

    def _build_file_cmd(
        self,
        wav_path: str,
        output_base: str,
        options: TranscribeOptions,
        want_srt: bool,
    ) -> list[str]:
        assert self._runtime is not None and self._model_path is not None

        cmd: list[str] = [
            self._runtime.binary_path,
            "--model",
            self._model_path,
            "--file",
            wav_path,
            "--output-json",
            "--output-file",
            output_base,
            "--threads",
            str(self._cpu_threads),
            "--beam-size",
            str(max(1, options.beam_size)),
            "--best-of",
            "1",
            "--suppress-nst",
            "--no-fallback",
            "--print-progress",
        ]

        if want_srt:
            # SRT needs timestamps; don't pass --no-timestamps here.
            cmd += ["--output-srt"]
        else:
            cmd += ["--no-timestamps"]

        if options.temperature and options.temperature > 0:
            cmd += ["--temperature", f"{options.temperature}"]

        if options.language and options.language != "auto":
            cmd += ["--language", options.language]
        else:
            cmd += ["--language", "auto"]

        if options.initial_prompt:
            cmd += ["--prompt", options.initial_prompt]

        return cmd

    def _run_whisper_file(
        self,
        cmd: list[str],
        output_base: str,
        duration_s: float,
        progress_cb: Optional[ProgressCallback],
        is_cancelled: Optional[Callable[[], bool]],
        want_srt: bool,
    ) -> TranscribeResult:
        assert self._runtime is not None
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
                cwd=os.path.dirname(self._runtime.binary_path),
                **hidden_kwargs(),
            )
        except OSError as e:
            return TranscribeResult(
                success=False,
                error="spawn_failed",
                message=f"Could not spawn whisper-cli: {e}",
            )

        q: "queue.Queue[object]" = queue.Queue()
        _DONE = object()

        def _drain(pipe):
            try:
                for line in pipe:
                    q.put(line)
            finally:
                q.put(_DONE)

        drainer = threading.Thread(target=_drain, args=(proc.stderr,), daemon=True)
        drainer.start()

        stderr_tail: list[str] = []  # keep last ~40 lines for error reporting
        last_emit = 0.0
        done = False
        while not done:
            try:
                item = q.get(timeout=0.5)
            except queue.Empty:
                if is_cancelled and is_cancelled():
                    proc.kill()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        pass
                    return TranscribeResult(
                        success=False, error="cancelled", message="Cancelled by user."
                    )
                continue

            if item is _DONE:
                done = True
                break

            line = item if isinstance(item, str) else ""
            stderr_tail.append(line.rstrip())
            if len(stderr_tail) > 40:
                stderr_tail.pop(0)

            if is_cancelled and is_cancelled():
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                return TranscribeResult(
                    success=False, error="cancelled", message="Cancelled by user."
                )

            m = self._PROGRESS_RE.search(line)
            if m and progress_cb is not None:
                pct = float(m.group(1))
                now = time.monotonic()
                if pct >= 99.0 or now - last_emit >= 0.5:
                    last_emit = now
                    try:
                        progress_cb(pct)
                    except Exception as e:  # noqa: BLE001
                        logger.warning(f"progress_cb raised: {e}")

        proc.wait()
        drainer.join(timeout=1)

        if proc.returncode != 0:
            tail = "\n".join(stderr_tail).strip()
            low = tail.lower()
            if "out of memory" in low or ("cuda" in low and "oom" in low):
                return TranscribeResult(
                    success=False,
                    error="cuda_oom",
                    message="GPU memory full. Try CPU mode or a smaller model.",
                )
            logger.error(
                f"whisper-cli (file) exited {proc.returncode}: {tail[-500:]}"
            )
            return TranscribeResult(
                success=False,
                error="transcription_failed",
                message=tail or f"whisper-cli exit code {proc.returncode}",
            )

        json_path = output_base + ".json"
        result = self._parse_json_output(json_path, int(duration_s * SAMPLE_RATE))

        if result.success and want_srt:
            srt_path = output_base + ".srt"
            if os.path.isfile(srt_path):
                try:
                    with open(srt_path, "r", encoding="utf-8") as f:
                        result.srt = f.read()
                except OSError as e:
                    logger.warning(f"Could not read SRT output: {e}")

        if result.success and progress_cb is not None:
            try:
                progress_cb(100.0)
            except Exception:  # noqa: BLE001
                pass

        return result
