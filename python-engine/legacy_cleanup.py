"""
X-Whisper — Legacy State Cleanup

Builds prior to the open-source release carried a client-side trial
counter and a login session. Those features are gone, but installs
that upgrade in place still have the state they left behind:

    keyring   X-Whisper / trial_state, access_token, refresh_token
    registry  HKCU\\Software\\XWhisper\\State            (Windows only)
    file      %LOCALAPPDATA%\\XWhisper\\.state           (Windows)
              {APP_DATA_DIR}/.state                       (mac / linux)
    config    "auth_user" key in config.json

`run()` removes all of it once, records that it did so in config.json,
and never raises — a failed cleanup must not stop the engine booting.
"""

from __future__ import annotations

import logging
import os
import platform

import api_keys
import settings_store
from config import APP_DATA_DIR

logger = logging.getLogger(__name__)

_DONE_FLAG = "_legacy_license_cleaned"
_KEYRING_ENTRIES = ("trial_state", "access_token", "refresh_token")
_REGISTRY_SUBKEY = r"Software\XWhisper\State"
_REGISTRY_PARENT = r"Software\XWhisper"


def _marker_path() -> str:
    if platform.system() == "Windows":
        base = os.environ.get(
            "LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local")
        )
        return os.path.join(base, "XWhisper", ".state")
    return os.path.join(APP_DATA_DIR, ".state")


def _clear_keyring() -> None:
    for name in _KEYRING_ENTRIES:
        try:
            api_keys.delete_key(name)
        except Exception as e:
            logger.debug(f"legacy cleanup: keyring '{name}' skipped: {e}")


def _clear_registry() -> None:
    if platform.system() != "Windows":
        return
    try:
        import winreg
    except ImportError:
        return
    for subkey in (_REGISTRY_SUBKEY, _REGISTRY_PARENT):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, subkey)
        except FileNotFoundError:
            pass
        except OSError as e:
            # Parent key may still hold other values — leave it alone.
            logger.debug(f"legacy cleanup: registry '{subkey}' skipped: {e}")


def _clear_marker() -> None:
    path = _marker_path()
    try:
        if os.path.isfile(path):
            os.remove(path)
        parent = os.path.dirname(path)
        if os.path.isdir(parent) and not os.listdir(parent):
            os.rmdir(parent)
    except OSError as e:
        logger.debug(f"legacy cleanup: marker '{path}' skipped: {e}")


def run() -> None:
    """Remove trial/auth leftovers from older builds. Idempotent."""
    try:
        settings = settings_store.load_settings()
        if settings.get(_DONE_FLAG):
            return

        _clear_keyring()
        _clear_registry()
        _clear_marker()

        settings.pop("auth_user", None)
        settings[_DONE_FLAG] = True
        settings_store.save_settings(settings)
        logger.info("Removed legacy trial/auth state from previous build")
    except Exception as e:
        logger.warning(f"legacy cleanup failed (non-fatal): {e}")
