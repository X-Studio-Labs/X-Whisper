"""
X-Whisper — Python Sidecar Engine

WebSocket server that fronts model management, audio capture, and
transcription. Phase 11 swapped WhisperEngine out for the provider
registry (providers.registry) so every model routes through a shared
BaseProvider interface.
"""

import os as _os
import platform as _platform
import sys
import threading as _threading
import time as _time

# ── Parent-death watchdog (non-Windows) ───────────────────────────────
# On Windows the Tauri shell binds us to a Job Object with
# KILL_ON_JOB_CLOSE, so the OS guarantees we die with the parent.
# On macOS/Linux there is no equivalent without root — instead we poll
# os.getppid() every second. When the parent exits our ppid changes to 1
# (init/launchd), which means the parent is gone; we exit cleanly so
# port 9876 is released for the next launch.
if _platform.system() != "Windows":
    _parent_pid = _os.getppid()

    def _watch_parent():
        while True:
            _time.sleep(1)
            if _os.getppid() != _parent_pid:
                _os._exit(0)

    _threading.Thread(target=_watch_parent, daemon=True).start()

import asyncio
import json
import logging
import signal

from config import WS_HOST, WS_PORT, LOG_LEVEL, ENGINE_LOG_FILE

# ── Logging Setup ─────────────────────────────────────────────
# stderr handler for the Tauri parent (which may or may not drain it),
# plus a rotating file under LOGS_DIR so we always have a record of
# what the engine did — the stderr pipe from the Rust launcher isn't
# read, so without the file handler the only record lives in a buffer
# that fills up and blocks the engine on write.
from logging.handlers import RotatingFileHandler

_log_fmt = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
_root = logging.getLogger()
_root.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
for _h in list(_root.handlers):
    _root.removeHandler(_h)
_stderr_h = logging.StreamHandler(sys.stderr)
_stderr_h.setFormatter(_log_fmt)
_root.addHandler(_stderr_h)
_file_h = RotatingFileHandler(
    ENGINE_LOG_FILE, maxBytes=2_000_000, backupCount=3, encoding="utf-8"
)
_file_h.setFormatter(_log_fmt)
_root.addHandler(_file_h)
logger = logging.getLogger("x-whisper")

# ── Managed-runtime preflight ─────────────────────────────────
# Before importing anything that pulls in torch / numpy / websockets
# etc., check that the host interpreter is inside the supported
# Python range. If not, bootstrap the isolated 3.12 runtime under
# %APPDATA%/X-Whisper/runtime/python and re-exec there. runtime_manager
# itself only depends on stdlib + config, so it is import-safe on any
# Python ≥ 3.6.
from runtime_manager import ensure_and_reexec, is_running_managed

ensure_and_reexec()  # no-op when already supported / managed

# ── Heavy imports (safe once preflight has passed) ────────────
from typing import Optional

import websockets
from websockets.asyncio.server import ServerConnection

from catalog import get_model, migrate_legacy_id
from ram_guard import RAMGuard
from audio_capture import AudioCapture
from model_manager import ModelManager
from providers import registry
from providers.base import TranscribeOptions
from providers.groq_provider import GROQ_KEY_NAME, GroqProvider
from settings_store import (
    load_settings, save_settings, update_setting, reset_settings,
    INITIAL_PROMPT_MAX_CHARS,
)
import transcript_history
from api_keys import set_key, get_key, delete_key, mask
from streaming import StreamingCoordinator
from hardware import detect_profile
from presets import preset_catalog, resolve_preset
from file_transcribe import FileTranscribeManager
import legacy_cleanup

logger.info(
    f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} "
    f"({'managed runtime' if is_running_managed() else 'system interpreter'})"
)

# ── Global State ──────────────────────────────────────────────
connected_clients: set[ServerConnection] = set()
audio_capture = AudioCapture()
model_manager = ModelManager()
active_stream: Optional[StreamingCoordinator] = None
file_transcribe_manager = FileTranscribeManager()


# ── Send helpers ──────────────────────────────────────────────

async def send_event(websocket: ServerConnection, event: dict):
    try:
        await websocket.send(json.dumps(event))
    except websockets.exceptions.ConnectionClosed:
        logger.warning("Attempted to send to a closed connection")


async def broadcast_event(event: dict):
    for client in connected_clients.copy():
        await send_event(client, event)


class _BroadcastSink:
    """Websocket-duck shim so helpers that expect a websocket (with
    `.send(json_str)`) can fan-out to every connected client instead.
    Used for backend-initiated jobs like auto-download from the hotkey."""

    async def send(self, payload: str):
        try:
            event = json.loads(payload)
        except Exception:
            return
        await broadcast_event(event)


broadcast_sink = _BroadcastSink()


def _sanitize_prompt(raw) -> Optional[str]:
    """Strip + cap the user's custom-vocabulary prompt. Empty → None so
    providers skip the flag entirely rather than passing an empty string."""
    if not isinstance(raw, str):
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None
    if len(trimmed) > INITIAL_PROMPT_MAX_CHARS:
        trimmed = trimmed[:INITIAL_PROMPT_MAX_CHARS]
    return trimmed


# ── Model load helper (shared by command handler + warm-load) ─

async def _load_model(
    model_id: str,
    device: Optional[str] = None,
    compute_type: Optional[str] = None,
    websocket: Optional[ServerConnection] = None,
) -> dict:
    """
    Resolve legacy IDs, route to the registry, and persist `last_model`
    on success. Model lifecycle events (model_loading / model_ready /
    error) are always broadcast to all connected clients — both the
    island and settings windows maintain their own stores and need to
    stay in sync regardless of which one issued the command. The
    `websocket` argument is accepted for symmetry with callers but is
    no longer used for scoping.
    """
    _ = websocket  # kept for call-site compatibility
    resolved = migrate_legacy_id(model_id)
    if resolved != model_id:
        logger.info(f"load_model: migrated '{model_id}' → '{resolved}'")

    active = registry.get_active()
    prev = getattr(active, "current_model", None) if active is not None else None
    logger.info(
        f"load_model: requested={resolved} "
        f"previous={prev or 'none'} "
        f"device_hint={device or 'auto'}"
    )

    async def _notify(event: dict):
        await broadcast_event(event)

    meta = get_model(resolved)
    if meta and meta.get("requires_network"):
        settings = load_settings()
        if settings.get("offline_only"):
            await _notify({
                "event": "error",
                "code": "offline_only",
                "message": (
                    f"{resolved} is a cloud model but Offline-Only mode is "
                    f"on. Turn it off under Settings → Cloud to use it."
                ),
            })
            return {
                "success": False,
                "model": resolved,
                "error": "offline_only",
                "message": "Offline-Only mode blocks cloud models.",
            }

    await _notify({"event": "model_loading", "model": resolved, "percent": 0})

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: registry.load(resolved, device=device, compute_type=compute_type),
    )

    payload = {
        "success": result.success,
        "model": result.model_id,
        "device": result.device,
        "compute_type": result.compute_type,
        "error": result.error,
        "message": result.message,
    }

    if result.success:
        update_setting("last_model", resolved)
        logger.info(
            f"load_model: ready model={result.model_id} "
            f"backend={result.device} compute={result.compute_type}"
        )
        await _notify({
            "event": "model_ready",
            "model": result.model_id,
            "device": result.device,
            "compute_type": result.compute_type,
        })
    else:
        logger.warning(
            f"load_model: failed model={resolved} "
            f"code={result.error} msg={result.message}"
        )
        await _notify({
            "event": "error",
            "code": result.error or "model_load_failed",
            "message": result.message or "Failed to load model",
            "model": resolved,
        })

    return payload


# ── File transcribe handlers ──────────────────────────────────

# Cap on how much of a file transcript we push into the 50-entry
# history panel. Full transcripts can be 100k+ chars on long files;
# the Settings History view isn't the right UI for that.
_FILE_HISTORY_TEXT_CAP = 2000


async def _handle_transcribe_file(websocket: ServerConnection, data: dict) -> None:
    path = (data.get("path") or "").strip()
    if not path:
        await send_event(websocket, {
            "event": "error",
            "code": "missing_path",
            "message": "transcribe_file requires a 'path'.",
        })
        return

    provider = registry.get_active()
    if provider is None or not provider.is_loaded:
        await send_event(websocket, {
            "event": "error",
            "code": "no_model",
            "message": "Load a model before transcribing a file.",
        })
        return

    if file_transcribe_manager.is_busy:
        snap = file_transcribe_manager.snapshot() or {}
        await send_event(websocket, {
            "event": "file_job_busy",
            "active_job_id": snap.get("job_id"),
            "filename": snap.get("filename"),
            "percent": snap.get("percent", 0.0),
            "message": "Another file is being transcribed.",
        })
        return

    settings = load_settings()
    options = TranscribeOptions(
        language=data.get("language") or settings.get("language"),
        beam_size=int(data.get("beam_size") or settings.get("beam_size", 1)),
        vad_filter=bool(settings.get("vad", True)),
        initial_prompt=_sanitize_prompt(settings.get("initial_prompt")),
    )
    want_srt = bool(data.get("want_srt", False))

    await file_transcribe_manager.run(
        path=path,
        options=options,
        want_srt=want_srt,
        broadcast=broadcast_event,
    )


async def _handle_save_file_transcript(websocket: ServerConnection, data: dict) -> None:
    text = (data.get("text") or "").strip()
    if not text:
        await send_event(websocket, {
            "event": "error",
            "code": "empty_transcript",
            "message": "Cannot save an empty transcript.",
        })
        return

    # Truncate very long file transcripts — history is a glance-able
    # list, not an archive; the user still has the full text / SRT in
    # the transcribe window and can re-export from disk.
    stored = text if len(text) <= _FILE_HISTORY_TEXT_CAP else text[:_FILE_HISTORY_TEXT_CAP] + "…"

    entry = transcript_history.append(
        stored,
        language=data.get("language"),
        duration=data.get("duration"),
        model=data.get("model"),
        provider=data.get("provider"),
    )
    if entry is None:
        await send_event(websocket, {
            "event": "error",
            "code": "history_save_failed",
            "message": "Could not write to transcripts history.",
        })
        return

    await broadcast_event({
        "event": "transcript_history_appended",
        "entry": entry,
    })
    await send_event(websocket, {
        "event": "file_transcript_saved",
        "id": entry["id"],
    })


# ── Command router ────────────────────────────────────────────

async def handle_command(websocket: ServerConnection, data: dict):
    cmd = data.get("cmd")
    logger.info(f"Received command: {cmd}")

    if cmd == "ping":
        await send_event(websocket, {"event": "pong"})

    elif cmd == "get_system_info":
        try:
            info = RAMGuard.get_system_info()
            info["engine_status"] = registry.get_status()
            await send_event(websocket, {"event": "system_info", **info})
        except Exception as e:
            logger.error(f"Failed to get system info: {e}")
            await send_event(websocket, {
                "event": "error",
                "code": "system_info_failed",
                "message": str(e),
            })

    elif cmd == "check_microphone":
        mic_info = AudioCapture.check_microphone()
        await send_event(websocket, {"event": "microphone_info", **mic_info})

    elif cmd == "list_devices":
        devices = AudioCapture.list_devices()
        await send_event(websocket, {"event": "device_list", "devices": devices})

    elif cmd == "start_recording":
        global active_stream
        # Guard: don't open the mic if there's no model to transcribe with.
        # Fail fast with a `no_model` event and kick off the download/load
        # so the island CTA can show progress without a second click.
        provider = registry.get_active()
        if provider is None or not provider.is_loaded:
            await _ensure_model_for_hotkey(websocket)
            return

        loop = asyncio.get_event_loop()
        await audio_capture.start(websocket, loop)

        settings = load_settings()
        streaming_enabled = bool(settings.get("streaming", True))
        initial_prompt = _sanitize_prompt(settings.get("initial_prompt"))
        if streaming_enabled and audio_capture.recording:
            stream_options = TranscribeOptions(
                language=data.get("language") or settings.get("language"),
                beam_size=1,
                vad_filter=bool(settings.get("vad", True)),
                initial_prompt=initial_prompt,
            )
            coord = StreamingCoordinator(
                audio_capture,
                stream_options,
                interval_ms=int(settings.get("stream_interval_ms", 2000)),
                min_buffer_sec=float(settings.get("stream_min_sec", 1.5)),
                max_window_sec=float(settings.get("stream_window_sec", 30.0)),
            )
            active_stream = coord
            await coord.start(lambda e: send_event(websocket, e))

    elif cmd == "stop_recording":
        if active_stream is not None:
            await active_stream.stop()
            active_stream = None

        audio_data = await audio_capture.stop()
        if audio_data is None:
            await send_event(websocket, {
                "event": "error",
                "code": "no_audio",
                "message": "No audio was captured",
            })
            return

        provider = registry.get_active()
        if provider is None or not provider.is_loaded:
            duration = len(audio_data) / 16000
            await send_event(websocket, {
                "event": "error",
                "code": "no_model",
                "message": (
                    f"No model loaded. Audio captured ({duration:.1f}s) but "
                    f"cannot transcribe. Load a model first."
                ),
            })
            return

        await send_event(websocket, {"event": "transcribing"})

        final_settings = load_settings()
        options = TranscribeOptions(
            language=data.get("language"),
            beam_size=data.get("beam_size", 1),
            vad_filter=data.get("vad_filter", True),
            initial_prompt=_sanitize_prompt(final_settings.get("initial_prompt")),
        )

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: provider.transcribe(audio_data, options),
        )

        if result.success:
            await send_event(websocket, {
                "event": "transcript",
                "text": result.text,
                "is_final": True,
                "language": result.language,
                "language_probability": result.language_probability,
                "duration": result.duration,
            })
            if final_settings.get("save_history", True):
                entry = transcript_history.append(
                    result.text,
                    language=result.language,
                    duration=result.duration,
                    model=getattr(provider, "current_model", None),
                    provider=getattr(provider, "provider_name", None),
                )
                if entry is not None:
                    await broadcast_event({
                        "event": "transcript_history_appended",
                        "entry": entry,
                    })
        else:
            await send_event(websocket, {
                "event": "error",
                "code": result.error or "transcription_failed",
                "message": result.message or "Transcription failed",
            })

    elif cmd == "load_model":
        await _load_model(
            model_id=data.get("model", "x-turbo"),
            device=data.get("device"),
            compute_type=data.get("compute_type"),
            websocket=websocket,
        )

    elif cmd == "unload_model":
        registry.unload()
        # Broadcast so every window's store clears its currentModel,
        # not just the one that clicked Unload.
        await broadcast_event({"event": "model_unloaded"})

    elif cmd == "get_engine_status":
        status = registry.get_status()
        await send_event(websocket, {"event": "engine_status", **status})

    elif cmd == "download_model":
        model = data.get("model", "x-turbo")
        result = await model_manager.download(model, websocket)
        if not result["success"]:
            await send_event(websocket, {
                "event": "error",
                "code": result.get("error", "download_failed"),
                "message": result.get("message", "Download failed"),
            })

    elif cmd == "cancel_download":
        model_manager.cancel_download()
        await send_event(websocket, {"event": "download_cancelled"})

    elif cmd == "list_models":
        models = model_manager.list_models()
        await send_event(websocket, {"event": "model_list", "models": models})

    elif cmd == "delete_model":
        model = data.get("model")
        if not model:
            return
        active = registry.get_active()
        if active is not None and active.current_model == model:
            registry.unload()
        result = model_manager.delete_model(model)
        if result["success"]:
            await send_event(websocket, {"event": "model_deleted", "model": model})
        else:
            await send_event(websocket, {
                "event": "error",
                "code": result.get("error"),
                "message": result.get("message"),
            })

    elif cmd == "get_settings":
        settings = load_settings()
        await send_event(websocket, {"event": "settings", "settings": settings})

    # Settings mutations broadcast `settings_saved` to every window, not
    # just the caller: the island (a separate WS client) reacts to keys
    # like island_visibility, and the settings/transcribe windows stay in
    # sync with each other.
    elif cmd == "save_settings":
        new_settings = data.get("settings", {})
        save_settings(new_settings)
        await broadcast_event({"event": "settings_saved", "settings": new_settings})

    elif cmd == "update_setting":
        key = data.get("key")
        value = data.get("value")
        if key:
            settings = update_setting(key, value)
            # Flipping save_history off: purge existing entries so the file
            # stops carrying stale data after the user opts out.
            if key == "save_history" and value is False:
                if transcript_history.clear():
                    await broadcast_event({"event": "transcript_history_cleared"})
            await broadcast_event({"event": "settings_saved", "settings": settings})

    elif cmd == "get_transcript_history":
        entries = transcript_history.list_entries()
        await send_event(websocket, {
            "event": "transcript_history",
            "entries": entries,
        })

    elif cmd == "delete_transcript":
        entry_id = data.get("id")
        if entry_id and transcript_history.delete(entry_id):
            await broadcast_event({
                "event": "transcript_deleted",
                "id": entry_id,
            })

    elif cmd == "clear_transcript_history":
        if transcript_history.clear():
            await broadcast_event({"event": "transcript_history_cleared"})

    elif cmd == "transcribe_file":
        await _handle_transcribe_file(websocket, data)

    elif cmd == "cancel_file_transcribe":
        job_id = data.get("job_id")
        cancelled = file_transcribe_manager.cancel(job_id)
        await send_event(websocket, {
            "event": "file_transcribe_cancel_ack",
            "cancelled": cancelled,
            "job_id": job_id,
        })

    elif cmd == "save_file_transcript":
        await _handle_save_file_transcript(websocket, data)

    elif cmd == "reset_settings":
        settings = reset_settings()
        await broadcast_event({"event": "settings_saved", "settings": settings})

    elif cmd == "complete_onboarding":
        settings = update_setting("onboarding_completed", True)
        await send_event(websocket, {"event": "onboarding_completed", "settings": settings})
        await broadcast_event({"event": "settings_saved", "settings": settings})
        logger.info("Onboarding marked as completed")

    elif cmd == "get_groq_key_status":
        existing = get_key(GROQ_KEY_NAME)
        await send_event(websocket, {
            "event": "groq_key_status",
            "has_key": bool(existing),
            "masked": mask(existing) if existing else "",
        })

    elif cmd == "set_groq_key":
        api_key = (data.get("api_key") or "").strip()
        if not api_key:
            await send_event(websocket, {
                "event": "error",
                "code": "missing_api_key",
                "message": "API key is empty.",
            })
            return

        loop = asyncio.get_event_loop()
        probe = await loop.run_in_executor(
            None, lambda: GroqProvider.test_api_key(api_key)
        )
        if not probe.get("ok"):
            await send_event(websocket, {
                "event": "groq_key_set",
                "success": False,
                "error": probe.get("error"),
                "message": probe.get("message"),
            })
            return

        saved = set_key(GROQ_KEY_NAME, api_key)
        await send_event(websocket, {
            "event": "groq_key_set",
            "success": saved,
            "masked": mask(api_key),
            "models": probe.get("models", []),
        })

    elif cmd == "test_groq_key":
        candidate = (data.get("api_key") or "").strip()
        if not candidate:
            candidate = get_key(GROQ_KEY_NAME) or ""
        loop = asyncio.get_event_loop()
        probe = await loop.run_in_executor(
            None, lambda: GroqProvider.test_api_key(candidate)
        )
        await send_event(websocket, {
            "event": "groq_key_tested",
            **probe,
        })

    elif cmd == "get_presets":
        settings = load_settings()
        cloud_available = bool(get_key(GROQ_KEY_NAME))
        profile = detect_profile()
        catalog = preset_catalog(
            profile,
            offline_only=bool(settings.get("offline_only", False)),
            cloud_available=cloud_available,
            custom_model_id=settings.get("model"),
        )
        await send_event(websocket, {
            "event": "presets",
            "current": settings.get("preset", "balanced"),
            "presets": catalog,
            "hardware": profile.to_dict(),
        })

    elif cmd == "apply_preset":
        preset_name = data.get("preset", "balanced")
        settings = load_settings()
        cloud_available = bool(get_key(GROQ_KEY_NAME))
        profile = detect_profile()
        resolved = resolve_preset(
            preset_name,
            profile,
            offline_only=bool(settings.get("offline_only", False)),
            cloud_available=cloud_available,
            custom_model_id=settings.get("model"),
        )

        update_setting("preset", preset_name)
        if preset_name != "custom":
            update_setting("model", resolved.model_id)

        await send_event(websocket, {
            "event": "preset_applied",
            "preset": preset_name,
            "resolved": {
                "model_id": resolved.model_id,
                "device": resolved.device,
                "compute_type": resolved.compute_type,
                "beam_size": resolved.beam_size,
                "reason": resolved.reason,
            },
        })

        # Load the resolved model unless the user is already on it.
        active = registry.get_active()
        already_loaded = (
            active is not None
            and active.is_loaded
            and getattr(active, "current_model", None) == resolved.model_id
        )
        if not already_loaded:
            await _load_model(
                resolved.model_id,
                device=resolved.device if resolved.device in ("cpu", "cuda") else None,
                compute_type=resolved.compute_type if resolved.compute_type in ("float16", "int8", "int8_float16") else None,
                websocket=websocket,
            )

    elif cmd == "clear_groq_key":
        active = registry.get_active()
        if active is not None and getattr(active, "provider_name", None) == "groq":
            registry.unload()
        removed = delete_key(GROQ_KEY_NAME)
        await send_event(websocket, {
            "event": "groq_key_cleared",
            "success": removed,
        })

    else:
        logger.warning(f"Unknown command: {cmd}")
        await send_event(websocket, {
            "event": "error",
            "code": "unknown_command",
            "message": f"Unknown command: {cmd}",
        })


# ── Connection lifecycle ──────────────────────────────────────

async def handler(websocket: ServerConnection):
    connected_clients.add(websocket)
    remote = websocket.remote_address
    logger.info(f"Client connected: {remote}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                await handle_command(websocket, data)
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received: {message[:100]}")
                await send_event(websocket, {
                    "event": "error",
                    "code": "invalid_json",
                    "message": "Invalid JSON format",
                })
    except websockets.exceptions.ConnectionClosedError as e:
        logger.info(f"Client {remote} disconnected: {e}")
    except websockets.exceptions.ConnectionClosedOK:
        logger.info(f"Client {remote} disconnected gracefully")
    finally:
        connected_clients.discard(websocket)
        logger.info(f"Client removed. Active connections: {len(connected_clients)}")


# ── Warm-load on startup ──────────────────────────────────────

async def _warm_load_background(delay_seconds: float = 2.0):
    """
    2 s after server boot, look up settings.last_model and (if the
    model exists in the catalog and its provider is wired up) load it
    without blocking. The island shows a "Warming…" state until
    model_ready broadcasts.
    """
    await asyncio.sleep(delay_seconds)

    try:
        settings = load_settings()
    except Exception as e:
        logger.warning(f"Warm-load: could not read settings: {e}")
        return

    if not settings.get("warm_load", True):
        logger.info("Warm-load disabled in settings — skipping")
        return

    target = settings.get("last_model") or settings.get("model")
    target = migrate_legacy_id(target) if target else None
    meta = get_model(target) if target else None

    # No usable saved model → fall back to the preset-resolved one.
    if meta is None:
        preset_name = settings.get("preset", "balanced")
        cloud_available = bool(get_key(GROQ_KEY_NAME))
        profile = detect_profile()
        resolved = resolve_preset(
            preset_name,
            profile,
            offline_only=bool(settings.get("offline_only", False)),
            cloud_available=cloud_available,
            custom_model_id=settings.get("model"),
        )
        target = resolved.model_id
        meta = get_model(target)
        if meta is None:
            logger.info(f"Warm-load: preset resolver returned '{target}' not in catalog — skipping")
            return
        logger.info(
            f"Warm-load: no last_model, preset '{preset_name}' → {target}"
        )

    if not registry.is_provider_wired(meta["provider"]):
        logger.info(f"Warm-load: provider '{meta['provider']}' not wired up yet")
        return

    if meta.get("requires_network") and settings.get("offline_only"):
        logger.info(f"Warm-load: '{target}' is cloud but offline_only is on — skipping")
        return

    if meta.get("requires_network") and not get_key(GROQ_KEY_NAME):
        logger.info(f"Warm-load: '{target}' needs Groq key — skipping")
        return

    # If the GGML weights aren't on disk yet (fresh install, interrupted
    # download, model deleted behind our back), fetch them before loading.
    # Cloud models skip this branch because their `downloaded` is virtual.
    if not meta.get("requires_network") and not _is_model_downloaded(target):
        logger.info(f"Warm-load: {target} not on disk — auto-downloading")
        await broadcast_event({"event": "model_warming", "model": target})
        dl = await model_manager.download(target, broadcast_sink)
        if not dl.get("success"):
            logger.warning(
                f"Warm-load: auto-download of {target} failed — "
                f"{dl.get('message', 'unknown error')}"
            )
            return

    logger.info(f"Warm-load: loading {target} in background")
    await broadcast_event({"event": "model_warming", "model": target})
    await _load_model(target, websocket=None)


async def _download_then_load(model_id: str) -> None:
    """Auto-download and auto-load. Used when the hotkey fires without a
    ready model — the island CTA keeps the user informed, but we do the
    actual work so the next hotkey press just works."""
    result = await model_manager.download(model_id, broadcast_sink)
    if not result.get("success"):
        logger.warning(
            f"auto-download of {model_id} failed: "
            f"{result.get('message', 'unknown error')}"
        )
        return
    await _load_model(model_id, websocket=None)


def _is_model_downloaded(model_id: str) -> bool:
    """Check the manager's listing for the given model's disk status."""
    for entry in model_manager.list_models():
        if entry["id"] == model_id:
            return bool(entry.get("downloaded"))
    return False


async def _ensure_model_for_hotkey(websocket) -> None:
    """
    Called when the hotkey fires with no model loaded. Resolves the
    target model, kicks off download and/or load in the background, and
    broadcasts a `no_model` error the island uses to render a CTA with
    live progress. The user just has to wait and re-press the hotkey.
    """
    settings = load_settings()
    target = settings.get("last_model") or settings.get("model")
    target = migrate_legacy_id(target) if target else None
    meta = get_model(target) if target else None

    if meta is None:
        # Fall back to the preset-resolved model when last_model is stale.
        profile = detect_profile()
        resolved = resolve_preset(
            settings.get("preset", "balanced"),
            profile,
            offline_only=bool(settings.get("offline_only", False)),
            cloud_available=bool(get_key(GROQ_KEY_NAME)),
            custom_model_id=settings.get("model"),
        )
        target = resolved.model_id
        meta = get_model(target)

    if meta is None:
        await broadcast_event({
            "event": "error",
            "code": "no_model",
            "message": "No model configured. Open Settings → Models.",
        })
        return

    downloaded = meta.get("requires_network") or _is_model_downloaded(target)

    if not downloaded:
        # Kick off the download if one isn't already running. Don't await
        # — we want the event to reach the UI immediately.
        if not model_manager.active_download():
            asyncio.create_task(_download_then_load(target))
        status = "downloading"
        msg = f"Downloading {meta.get('display', target)} — press the hotkey again when ready."
    else:
        # Model on disk but not loaded → kick off the load.
        asyncio.create_task(_load_model(target, websocket=None))
        status = "loading"
        msg = f"Loading {meta.get('display', target)} — press the hotkey again in a moment."

    logger.info(f"no_model guard: target={target} status={status}")
    await broadcast_event({
        "event": "error",
        "code": "no_model",
        "message": msg,
        "model": target,
        "status": status,
    })


# ── Main ──────────────────────────────────────────────────────

async def main():
    logger.info(f"X-Whisper Engine starting on ws://{WS_HOST}:{WS_PORT}")

    # Installs upgraded from the pre-open-source build may still carry
    # trial/auth state on disk. Best-effort, runs once, never raises.
    legacy_cleanup.run()

    stop = asyncio.Future()

    def signal_handler():
        if not stop.done():
            stop.set_result(None)

    loop = asyncio.get_event_loop()
    if sys.platform != "win32":
        loop.add_signal_handler(signal.SIGTERM, signal_handler)
        loop.add_signal_handler(signal.SIGINT, signal_handler)

    async with websockets.serve(
        handler,
        WS_HOST,
        WS_PORT,
        ping_interval=20,
        ping_timeout=20,
        max_size=10 * 1024 * 1024,
    ):
        logger.info(f"WebSocket server ready on ws://{WS_HOST}:{WS_PORT}")

        # Kick off the warm-load without blocking the server startup.
        asyncio.create_task(_warm_load_background())

        if sys.platform == "win32":
            await asyncio.Future()
        else:
            await stop

    logger.info("X-Whisper Engine stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Shutdown via KeyboardInterrupt")
