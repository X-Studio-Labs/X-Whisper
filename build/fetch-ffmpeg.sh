#!/usr/bin/env bash
# X-Whisper — Fetch static arm64 ffmpeg for macOS.
#
# Bash sibling of build/fetch-ffmpeg.ps1. Downloads a zero-dependency
# static ffmpeg build from evermeet.cx and stages it at
# binaries/ffmpeg/ffmpeg with chmod 0755.
#
# Usage: bash build/fetch-ffmpeg.sh [-f]
#   -f  Force re-download even if the binary already exists.
#
# Idempotent: skips if binaries/ffmpeg/ffmpeg already exists.

set -euo pipefail

FORCE=0
if [[ "${1:-}" == "-f" ]]; then
    FORCE=1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DEST_DIR="$REPO_ROOT/binaries/ffmpeg"
DEST_BIN="$DEST_DIR/ffmpeg"

step() { echo "[fetch-ffmpeg] $*"; }

if [[ -x "$DEST_BIN" && "$FORCE" -eq 0 ]]; then
    step "already present at $DEST_BIN — skipping (pass -f to re-fetch)"
    exit 0
fi

if [[ "$(uname -m)" != "arm64" ]]; then
    echo "error: this script only fetches the arm64 build. uname -m says $(uname -m)." >&2
    exit 1
fi

# evermeet.cx serves static macOS ffmpeg. Their builds are x86_64
# but run transparently via Rosetta 2 on Apple Silicon. We only use
# ffmpeg for duration probing (ffmpeg -i), so the x86_64 overhead is
# negligible.
FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"

step "downloading static arm64 ffmpeg from evermeet.cx..."
TMP_ZIP="$(mktemp /tmp/xw-ffmpeg-XXXXXX.zip)"
trap 'rm -f "$TMP_ZIP"' EXIT

if ! curl -fL --progress-bar -A "Mozilla/5.0" "$FFMPEG_URL" -o "$TMP_ZIP"; then
    echo "error: ffmpeg download failed" >&2
    exit 1
fi

step "extracting..."
TMP_DIR="$(mktemp -d /tmp/xw-ffmpeg-extract-XXXXXX)"
trap 'rm -f "$TMP_ZIP"; rm -rf "$TMP_DIR"' EXIT

unzip -q "$TMP_ZIP" -d "$TMP_DIR"

FFMPEG_BIN=$(find "$TMP_DIR" -name "ffmpeg" -type f | head -1)
if [[ -z "$FFMPEG_BIN" ]]; then
    echo "error: could not find ffmpeg binary in zip" >&2
    exit 1
fi

mkdir -p "$DEST_DIR"
cp "$FFMPEG_BIN" "$DEST_BIN"
chmod 0755 "$DEST_BIN"

step "ready: $DEST_BIN ($("$DEST_BIN" -version 2>&1 | head -1))"
