#!/usr/bin/env bash
# X-Whisper — Build whisper.cpp with Metal backend for Apple Silicon.
#
# Sibling of build/fetch-whisper-cpp.ps1 (Windows CUDA/CPU) and
# build/build-whisper-cpp-vulkan.ps1 (Windows Vulkan). Unlike those,
# we build from source on macOS because ggerganov/whisper.cpp doesn't
# ship prebuilt Metal binaries — Metal requires linking against
# Metal.framework on the build host.
#
# Usage: bash build/build-whisper-cpp-metal.sh [-f]
#   -f  Force re-clone and rebuild even if output already exists.
#
# Idempotent: re-running skips the clone/build if whisper-cli is
# already staged. Matches the -Force semantics of its PowerShell
# siblings.

set -euo pipefail

VERSION="v1.8.4"
FORCE=0
if [[ "${1:-}" == "-f" ]]; then
    FORCE=1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WORK_DIR="$SCRIPT_DIR/.work/whisper.cpp-metal"
DEST_DIR="$REPO_ROOT/binaries/whisper-cpp/metal"
DEST_BIN="$DEST_DIR/whisper-cli"

step() { echo "[whisper.cpp-metal] $*"; }

if [[ -x "$DEST_BIN" && "$FORCE" -eq 0 ]]; then
    step "already present at $DEST_BIN — skipping (pass -f to rebuild)"
    exit 0
fi

if [[ "$(uname -m)" != "arm64" ]]; then
    echo "error: this script only builds arm64. uname -m says $(uname -m)." >&2
    exit 1
fi

step "cloning whisper.cpp $VERSION..."
mkdir -p "$WORK_DIR"
if [[ ! -d "$WORK_DIR/.git" ]]; then
    git clone --depth 1 --branch "$VERSION" https://github.com/ggerganov/whisper.cpp "$WORK_DIR"
else
    (cd "$WORK_DIR" && git fetch --depth 1 origin "refs/tags/$VERSION:refs/tags/$VERSION" && git checkout "$VERSION")
fi

step "configuring with Metal enabled..."
rm -rf "$WORK_DIR/build"
cmake -S "$WORK_DIR" -B "$WORK_DIR/build" \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY=ON \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_BUILD_TYPE=Release

step "building whisper-cli..."
cmake --build "$WORK_DIR/build" -j --config Release --target whisper-cli

step "staging to $DEST_DIR..."
mkdir -p "$DEST_DIR"
# Binary lives at build/bin/whisper-cli in v1.8.x layouts.
cp "$WORK_DIR/build/bin/whisper-cli" "$DEST_BIN"
chmod 0755 "$DEST_BIN"

step "ready: $DEST_BIN ($(stat -f %z "$DEST_BIN") bytes)"
