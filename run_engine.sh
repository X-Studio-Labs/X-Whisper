#!/usr/bin/env bash
# X-Whisper — macOS Engine Launcher
#
# Bash sibling of run_engine.ps1. Canonical way to start the Python
# engine in development on macOS. Guarantees the engine always runs
# under the managed Python 3.12 runtime at
#   ~/Library/Application Support/X-Whisper/runtime/python/
# regardless of what Python is (or isn't) on PATH.
#
# Usage:
#   bash run_engine.sh                 # ensure runtime, launch engine
#   bash run_engine.sh -BootstrapOnly  # install runtime, then exit
#   bash run_engine.sh -Force          # re-download runtime from scratch

set -euo pipefail

BOOTSTRAP_ONLY=0
FORCE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        -BootstrapOnly) BOOTSTRAP_ONLY=1; shift ;;
        -Force)         FORCE=1;          shift ;;
        *) shift ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$SCRIPT_DIR/python-engine"
RUNTIME_DIR="$HOME/Library/Application Support/X-Whisper/runtime/python"
MANAGED_PYTHON="$RUNTIME_DIR/bin/python3.12"
REQUIREMENTS_FILE="$ENGINE_DIR/requirements.txt"
BOOTSTRAP_SCRIPT="$ENGINE_DIR/bootstrap.sh"

NEEDS_BOOTSTRAP=0
[[ "$FORCE" -eq 1 ]] && NEEDS_BOOTSTRAP=1
[[ ! -x "$MANAGED_PYTHON" ]] && NEEDS_BOOTSTRAP=1

if [[ "$NEEDS_BOOTSTRAP" -eq 1 ]]; then
    echo "[x-whisper] Managed Python runtime not found — bootstrapping..."
    BOOTSTRAP_ARGS=("-RuntimeDir" "$RUNTIME_DIR" "-RequirementsFile" "$REQUIREMENTS_FILE")
    [[ "$FORCE" -eq 1 ]] && BOOTSTRAP_ARGS+=("-Force")
    bash "$BOOTSTRAP_SCRIPT" "${BOOTSTRAP_ARGS[@]}"
fi

if [[ "$BOOTSTRAP_ONLY" -eq 1 ]]; then
    echo "[x-whisper] Runtime ready at $MANAGED_PYTHON."
    exit 0
fi

MAIN_PY="$ENGINE_DIR/main.py"
echo "[x-whisper] Launching engine: $MANAGED_PYTHON $MAIN_PY"
exec "$MANAGED_PYTHON" "$MAIN_PY"
