"""
X-Whisper — Transcript History

Persists the most recent N successful transcriptions to
`%APPDATA%/X-Whisper/transcripts.json` so users can copy / re-paste
past results. FIFO-capped; not encrypted (single-user consumer app,
text lives in plain JSON alongside config.json).
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from config import TRANSCRIPTS_FILE

logger = logging.getLogger(__name__)

MAX_ENTRIES = 50


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_raw() -> list[dict]:
    if not os.path.exists(TRANSCRIPTS_FILE):
        return []
    try:
        with open(TRANSCRIPTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return [e for e in data if isinstance(e, dict)]
        return []
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"transcripts.json unreadable ({e}); starting fresh")
        return []


def _save_raw(entries: list[dict]) -> bool:
    try:
        os.makedirs(os.path.dirname(TRANSCRIPTS_FILE), exist_ok=True)
        with open(TRANSCRIPTS_FILE, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2, ensure_ascii=False)
        return True
    except IOError as e:
        logger.error(f"Failed to write transcripts.json: {e}")
        return False


def list_entries() -> list[dict]:
    """Newest first."""
    entries = _load_raw()
    return list(reversed(entries))


def append(
    text: str,
    *,
    language: Optional[str] = None,
    duration: Optional[float] = None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
) -> Optional[dict]:
    """Add a new entry. Returns the stored record (or None on I/O failure).
    Empty / whitespace-only text is skipped — no UX value in listing blanks."""
    if not isinstance(text, str) or not text.strip():
        return None

    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "text": text,
        "language": language,
        "duration": duration,
        "model": model,
        "provider": provider,
        "created_at": _now_iso(),
    }

    entries = _load_raw()
    entries.append(entry)
    # Trim from the front (oldest) so we keep at most MAX_ENTRIES.
    if len(entries) > MAX_ENTRIES:
        entries = entries[-MAX_ENTRIES:]

    if _save_raw(entries):
        return entry
    return None


def delete(entry_id: str) -> bool:
    entries = _load_raw()
    filtered = [e for e in entries if e.get("id") != entry_id]
    if len(filtered) == len(entries):
        return False
    return _save_raw(filtered)


def clear() -> bool:
    """Wipe all entries. Removes the file outright so disk usage goes
    to zero, not just an empty JSON array."""
    try:
        if os.path.exists(TRANSCRIPTS_FILE):
            os.remove(TRANSCRIPTS_FILE)
        return True
    except IOError as e:
        logger.error(f"Failed to clear transcripts.json: {e}")
        return False
