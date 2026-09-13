"""
X-Whisper — Model Manager

Lists, downloads, and deletes X- models against the catalog. Download
progress streams via WebSocket.
"""

import asyncio
import json
import logging
import os
import shutil
import threading
from typing import Optional

from catalog import X_MODELS, get_model
from config import MODELS_DIR

logger = logging.getLogger(__name__)


# Any of these extensions, or this filename, counts as a downloaded
# model weight — primarily whisper.cpp GGML (ggml-*.bin). The extra
# extensions catch leftover CT2 / HF / safetensors files from pre-
# migration installs so the UI doesn't redundantly flag a model as
# needing re-download.
_WEIGHT_EXTS = (".bin", ".ct2", ".safetensors", ".pt", ".pth", ".onnx")
_WEIGHT_FILENAMES = {"model.bin"}


def _has_weight_file(local_path: str) -> bool:
    for dirpath, _, filenames in os.walk(local_path):
        for f in filenames:
            if f in _WEIGHT_FILENAMES or f.endswith(_WEIGHT_EXTS):
                return True
    return False


def _expected_ggml_path(local_dir: str, meta: dict) -> Optional[str]:
    """Return the exact GGML file path for whisper_cpp models, else None."""
    if meta.get("provider") != "whisper_cpp":
        return None
    ggml_file = meta.get("ggml_file")
    if not ggml_file:
        return None
    return os.path.join(local_dir, ggml_file)


class ModelManager:
    """Orchestrates on-disk model lifecycle for the GGML models served
    by the whisper.cpp provider. Single-file GGML weights are pulled
    via hf_hub_download; cloud provider entries short-circuit (nothing
    to download locally)."""

    def __init__(self):
        self._active_download: Optional[str] = None
        self._cancel_download = False
        self._download_progress = 0.0

    # ── Listing ───────────────────────────────────────────────────

    def list_models(self) -> list[dict]:
        """Every catalog entry with its on-disk status + rich metadata."""
        out: list[dict] = []
        for mid, info in X_MODELS.items():
            local_path = os.path.join(MODELS_DIR, mid)
            is_downloaded = False
            disk_size_mb = 0.0

            if os.path.exists(local_path):
                try:
                    ggml_path = _expected_ggml_path(local_path, info)
                    if ggml_path is not None:
                        # whisper_cpp: presence of the exact GGML file
                        # is the authoritative check; a stale CT2 dir
                        # should not masquerade as downloaded.
                        is_downloaded = os.path.isfile(ggml_path)
                    else:
                        is_downloaded = _has_weight_file(local_path)
                    if is_downloaded:
                        for dirpath, _, filenames in os.walk(local_path):
                            for f in filenames:
                                try:
                                    disk_size_mb += os.path.getsize(
                                        os.path.join(dirpath, f)
                                    )
                                except OSError:
                                    pass
                        disk_size_mb = round(disk_size_mb / (1024 * 1024), 1)
                except OSError:
                    pass

            # Cloud providers are "ready" as soon as the provider itself
            # is reachable — there's nothing to download locally.
            if info.get("requires_network"):
                is_downloaded = True

            out.append({
                "id": mid,
                "name": mid,          # kept for back-compat with old UI
                "display": info["display"],
                "provider": info["provider"],
                "repo": info["repo"],
                "size_mb": info["size_mb"],
                "min_ram_gb": info["min_ram_gb"],
                "gpu_preferred": info.get("gpu_preferred", False),
                "languages": info["languages"],
                "accuracy": info["accuracy"],
                "speed": info["speed"],
                "requires_extra_deps": info.get("requires_extra_deps", []),
                "requires_network": info.get("requires_network", False),
                "downloaded": is_downloaded,
                "disk_size_mb": disk_size_mb,
                "local_path": local_path if is_downloaded else None,
            })
        return out

    # ── Download ──────────────────────────────────────────────────

    def active_download(self) -> Optional[str]:
        """Model id of the current download, or None if idle."""
        return self._active_download

    async def download(self, model_id: str, websocket) -> dict:
        """Pull a model from HuggingFace with live progress events."""
        meta = get_model(model_id)
        if meta is None:
            return {
                "success": False,
                "error": "unknown_model",
                "message": f"Unknown model: {model_id}",
            }

        if meta.get("requires_network"):
            return {
                "success": False,
                "error": "cloud_model",
                "message": f"{model_id} is a cloud model — nothing to download.",
            }

        repo_id = meta["repo"]
        local_dir = os.path.join(MODELS_DIR, model_id)
        total_mb = meta["size_mb"]
        ggml_file = meta.get("ggml_file")  # only set for whisper_cpp entries

        # Already downloaded?
        if os.path.exists(local_dir) and os.listdir(local_dir):
            already = (
                os.path.isfile(os.path.join(local_dir, ggml_file))
                if ggml_file
                else _has_weight_file(local_dir)
            )
            if already:
                logger.info(f"{model_id} already exists at {local_dir}")
                return {
                    "success": True,
                    "model": model_id,
                    "already_exists": True,
                }

        self._cancel_download = False
        self._active_download = model_id
        self._download_progress = 0.0

        logger.info(
            f"Downloading {repo_id}"
            + (f" ({ggml_file})" if ggml_file else "")
            + f" → {local_dir}"
        )

        try:
            await self._send_progress(websocket, model_id, 0, 0, total_mb)

            error: list[Optional[Exception]] = [None]
            done = threading.Event()

            def do_download():
                try:
                    if ggml_file:
                        # whisper.cpp: single-file GGML pull from the
                        # upstream repo. Saves bandwidth vs a full
                        # snapshot of ggerganov/whisper.cpp (many GB).
                        from huggingface_hub import hf_hub_download
                        os.makedirs(local_dir, exist_ok=True)
                        hf_hub_download(
                            repo_id=repo_id,
                            filename=ggml_file,
                            local_dir=local_dir,
                            local_dir_use_symlinks=False,
                        )
                    else:
                        from huggingface_hub import snapshot_download
                        snapshot_download(
                            repo_id=repo_id,
                            local_dir=local_dir,
                            local_dir_use_symlinks=False,
                        )
                except Exception as e:
                    error[0] = e
                finally:
                    done.set()

            threading.Thread(target=do_download, daemon=True).start()

            # Poll disk size for progress.
            while not done.is_set():
                if self._cancel_download:
                    break
                current_mb = 0.0
                if os.path.exists(local_dir):
                    for dirpath, _, filenames in os.walk(local_dir):
                        for f in filenames:
                            try:
                                current_mb += os.path.getsize(
                                    os.path.join(dirpath, f)
                                )
                            except OSError:
                                pass
                    current_mb /= 1024 * 1024
                percent = min((current_mb / total_mb) * 100, 99.0) if total_mb else 0
                self._download_progress = percent
                await self._send_progress(
                    websocket, model_id, percent, current_mb, total_mb
                )
                await asyncio.sleep(1.0)

            if self._cancel_download:
                if os.path.exists(local_dir):
                    shutil.rmtree(local_dir, ignore_errors=True)
                return {
                    "success": False,
                    "error": "cancelled",
                    "message": "Download cancelled",
                }

            if error[0]:
                raise error[0]

            await self._send_progress(websocket, model_id, 100, total_mb, total_mb)
            logger.info(f"Download complete: {model_id}")
            await self._send_event(websocket, {
                "event": "download_complete",
                "model": model_id,
            })
            return {"success": True, "model": model_id, "path": local_dir}

        except Exception as e:
            logger.error(f"Download failed for {model_id}: {e}")
            if os.path.exists(local_dir):
                shutil.rmtree(local_dir, ignore_errors=True)
            return {
                "success": False,
                "error": "download_failed",
                "message": str(e),
            }
        finally:
            self._active_download = None

    def cancel_download(self):
        if self._active_download:
            logger.info(f"Cancelling download: {self._active_download}")
            self._cancel_download = True

    # ── Delete ────────────────────────────────────────────────────

    def delete_model(self, model_id: str) -> dict:
        local_path = os.path.join(MODELS_DIR, model_id)
        if os.path.exists(local_path):
            shutil.rmtree(local_path)
            logger.info(f"Deleted {model_id}")
            return {"success": True, "model": model_id}
        return {
            "success": False,
            "error": "not_found",
            "message": f"Model {model_id} not on disk",
        }

    # ── Event helpers ─────────────────────────────────────────────

    async def _send_progress(
        self,
        websocket,
        model: str,
        percent: float,
        mb_done: float,
        mb_total: float,
    ):
        await self._send_event(websocket, {
            "event": "download_progress",
            "model": model,
            "percent": round(percent, 1),
            "mb_done": round(mb_done, 1),
            "mb_total": round(mb_total, 1),
        })

    async def _send_event(self, websocket, event: dict):
        try:
            await websocket.send(json.dumps(event))
        except Exception as e:
            logger.error(f"Failed to send event: {e}")
