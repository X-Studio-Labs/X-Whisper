#!/usr/bin/env bash
# X-Whisper — macOS managed Python runtime bootstrap.
#
# Downloads a relocatable CPython 3.12 from indygreg/python-build-standalone
# into RUNTIME_DIR and installs requirements.txt against it.
#
# Mirror of bootstrap.ps1 (Windows). Argument names intentionally match
# the PowerShell version so docs stay parallel.
#
# Usage:
#   bash bootstrap.sh [-RuntimeDir <dir>] [-RequirementsFile <file>] [-BootstrapOnly] [-Force]
#
# Exit codes: 0=success, 1=download failed, 2=extract failed,
#             3=pip bootstrap failed, 4=requirements install failed.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

RUNTIME_DIR="$HOME/Library/Application Support/X-Whisper/runtime/python"
REQUIREMENTS_FILE="$SCRIPT_DIR/requirements.txt"
BOOTSTRAP_ONLY=0
FORCE=0

# ── Argument parsing (mirrors PowerShell -Param style) ────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        -RuntimeDir)     RUNTIME_DIR="$2";      shift 2 ;;
        -RequirementsFile) REQUIREMENTS_FILE="$2"; shift 2 ;;
        -BootstrapOnly)  BOOTSTRAP_ONLY=1;      shift ;;
        -Force)          FORCE=1;               shift ;;
        *) shift ;;
    esac
done

PYTHON_BIN="$RUNTIME_DIR/bin/python3.12"

step() { echo "[bootstrap] $*"; }

# ── Idempotency check ─────────────────────────────────────────────────
if [[ -x "$PYTHON_BIN" && "$FORCE" -eq 0 ]]; then
    ver=$("$PYTHON_BIN" --version 2>&1)
    step "managed runtime already present ($ver) — skipping (pass -Force to reinstall)"
    exit 0
fi

if [[ "$(uname -m)" != "arm64" ]]; then
    echo "error: bootstrap.sh only supports arm64. uname -m says $(uname -m)." >&2
    exit 1
fi

# ── Resolve latest CPython 3.12 aarch64 tarball from indygreg releases ─
RELEASE_API="https://api.github.com/repos/indygreg/python-build-standalone/releases"
step "resolving latest CPython 3.12 aarch64-apple-darwin tarball..."
TARBALL_URL=$(curl -fsSL "$RELEASE_API?per_page=10" | \
    python3 -c "
import json, sys
releases = json.load(sys.stdin)
for release in releases:
    for asset in release.get('assets', []):
        name = asset['name']
        if ('cpython-3.12' in name and
            'aarch64-apple-darwin' in name and
            'install_only' in name and
            name.endswith('.tar.gz')):
            print(asset['browser_download_url'])
            sys.exit(0)
sys.exit(1)
" 2>/dev/null) || true

if [[ -z "$TARBALL_URL" ]]; then
    # Hardcoded fallback for offline/rate-limited scenarios
    TARBALL_URL="https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-aarch64-apple-darwin-install_only.tar.gz"
    step "API lookup failed — using fallback URL"
fi

step "downloading $TARBALL_URL..."
TMP_TARBALL="$(mktemp /tmp/xw-python-XXXXXX.tar.gz)"
trap 'rm -f "$TMP_TARBALL"' EXIT

if ! curl -fL --progress-bar "$TARBALL_URL" -o "$TMP_TARBALL"; then
    echo "error: download failed" >&2
    exit 1
fi

# ── Extract ───────────────────────────────────────────────────────────
step "extracting to $RUNTIME_DIR..."
RUNTIME_PARENT="$(dirname "$RUNTIME_DIR")"
RUNTIME_NAME="$(basename "$RUNTIME_DIR")"

if [[ "$FORCE" -eq 1 ]]; then
    rm -rf "$RUNTIME_DIR"
fi
mkdir -p "$RUNTIME_PARENT"

# The tarball always extracts to a top-level `python/` directory.
# Extract into a temp dir next to RUNTIME_PARENT, then rename into place.
TMP_EXTRACT="$(mktemp -d "$RUNTIME_PARENT/xw-extract-XXXXXX")"
trap 'rm -f "$TMP_TARBALL"; rm -rf "$TMP_EXTRACT"' EXIT

if ! tar -xzf "$TMP_TARBALL" -C "$TMP_EXTRACT"; then
    echo "error: extraction failed" >&2
    exit 2
fi

# Move the extracted `python/` into place as RUNTIME_DIR.
mv "$TMP_EXTRACT/python" "$RUNTIME_DIR"
chmod 0755 "$PYTHON_BIN"

ver=$("$PYTHON_BIN" --version 2>&1)
step "Python installed: $ver"

# ── Install requirements ──────────────────────────────────────────────
if [[ -f "$REQUIREMENTS_FILE" ]]; then
    step "installing requirements from $REQUIREMENTS_FILE..."
    if ! "$PYTHON_BIN" -m pip install --upgrade --quiet -r "$REQUIREMENTS_FILE"; then
        echo "error: requirements install failed" >&2
        exit 4
    fi
    step "requirements installed"
else
    step "no requirements.txt found at $REQUIREMENTS_FILE — skipping pip install"
fi

step "bootstrap complete: $PYTHON_BIN"
