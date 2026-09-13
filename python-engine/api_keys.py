"""
X-Whisper — API Key Storage

Stores cloud provider credentials (Groq, and later any others) in the
OS keyring: Windows Credential Manager, macOS Keychain, or
libsecret on Linux. When the keyring backend is unavailable (rare on
desktop, common on headless CI), writes to a `secrets.json` in the
app-data dir instead — noted as less secure but still out of the
project tree.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

from config import APP_DATA_DIR

logger = logging.getLogger(__name__)

SERVICE_NAME = "X-Whisper"
SECRETS_FILE = os.path.join(APP_DATA_DIR, "secrets.json")


# ── Keyring probing ──────────────────────────────────────────────────

def _try_keyring():
    """Return the keyring module if a usable backend is available."""
    try:
        import keyring
        from keyring.backends.fail import Keyring as FailKeyring
        backend = keyring.get_keyring()
        if isinstance(backend, FailKeyring):
            logger.info("Keyring fail backend detected — using file fallback")
            return None
        return keyring
    except Exception as e:
        logger.warning(f"Keyring unavailable: {e}")
        return None


# ── File fallback ────────────────────────────────────────────────────

def _fallback_read() -> dict:
    if not os.path.exists(SECRETS_FILE):
        return {}
    try:
        with open(SECRETS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def _fallback_write(data: dict) -> None:
    os.makedirs(os.path.dirname(SECRETS_FILE), exist_ok=True)
    with open(SECRETS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ── Public API ───────────────────────────────────────────────────────

def set_key(name: str, value: str) -> bool:
    kr = _try_keyring()
    if kr is not None:
        try:
            kr.set_password(SERVICE_NAME, name, value)
            return True
        except Exception as e:
            logger.warning(f"Keyring set failed: {e}. Falling back to file.")

    data = _fallback_read()
    data[name] = value
    try:
        _fallback_write(data)
        return True
    except Exception as e:
        logger.error(f"Fallback write failed: {e}")
        return False


def get_key(name: str) -> Optional[str]:
    kr = _try_keyring()
    if kr is not None:
        try:
            value = kr.get_password(SERVICE_NAME, name)
            if value:
                return value
        except Exception as e:
            logger.warning(f"Keyring get failed: {e}")
    return _fallback_read().get(name)


def delete_key(name: str) -> bool:
    deleted_any = False

    kr = _try_keyring()
    if kr is not None:
        try:
            kr.delete_password(SERVICE_NAME, name)
            deleted_any = True
        except Exception:
            pass

    data = _fallback_read()
    if name in data:
        del data[name]
        try:
            _fallback_write(data)
            deleted_any = True
        except Exception:
            pass

    return deleted_any


def has_key(name: str) -> bool:
    return bool(get_key(name))


def mask(value: str) -> str:
    """Mask an API key for display (e.g., 'gsk_••••abcd')."""
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return f"{value[:4]}{'•' * 8}{value[-4:]}"
