# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

Shell is bash on Windows — use Unix syntax, forward-slash paths, `/dev/null`.

- `npm run tauri dev` — full dev loop (Tauri spawns vite + Python engine).
- `npm run dev` — vite only, on port 1420. Rarely useful alone; the UI needs the engine.
- `npm run build` — `tsc && vite build`, produces `dist/`. There is no lint or test script.
- `./run_engine.ps1` (Windows) / `bash run_engine.sh` (macOS) — run the Python engine standalone against the managed runtime. `-BootstrapOnly` just sets up the runtime dir; `-Force` re-downloads.
- Release builds — `pwsh build/fetch-whisper-cpp.ps1 && pwsh build/fetch-ffmpeg.ps1 && pwsh build/build-whisper-cpp-vulkan.ps1 && npm install && npm run tauri build` on Windows; `bash build/build-whisper-cpp-metal.sh && bash build/fetch-ffmpeg.sh` on macOS. The fetch scripts populate `binaries/` (gitignored) which `tauri.conf.json` / `tauri.macos.conf.json` bundle. `binaries/` must exist or Rust bundling fails. Upstream whisper.cpp ships no Windows Vulkan zip, so `build-whisper-cpp-vulkan.ps1` compiles it from source (needs VS C++ Build Tools, cmake on PATH — run from a VS dev shell — and the LunarG Vulkan SDK with `VULKAN_SDK` set).
- `cargo check` from `src-tauri/` is the Rust type-check. `tauri-build` verifies that every `bundle.resources` path exists, so `binaries/` must be populated (or stubbed) first.

## Architecture

Three-process desktop app. The Rust shell owns windows + OS integration, the Python sidecar owns all transcription, and the React UI never touches models directly.

**Rust (Tauri v2) — `src-tauri/src/lib.rs`**
- Spawns `python-engine/main.py` as a child on startup, binds it to a Windows Job Object with `KILL_ON_JOB_CLOSE` so the engine can't orphan when the parent dies (port 9876 would otherwise stay bound).
- `hidden_command()` wraps every `Command` with `CREATE_NO_WINDOW` so child spawns don't flash consoles.
- Runtime bootstrap: if the managed Python (`%APPDATA%\X-Whisper\runtime\python\` on Windows, `~/Library/Application Support/X-Whisper/runtime/python/` on macOS) is missing, the Rust shell runs `python-engine/bootstrap.ps1` / `bootstrap.sh` before spawning the engine — consumers never install Python.
- Owns four windows, built on demand by label: `island` (always-on-top overlay), `settings`, `onboarding`, `transcribe`. `preferred_*_size()` helpers compute monitor-relative sizes so every entry point (tray, island button, hotkey) lands at the same size.
- Tauri commands exposed to JS: `paste_text`, `open_settings`, `open_transcribe_window`, `save_text_file`, `engine_status`, `restart_engine`, `set_launch_at_startup`, `get_launch_at_startup` (last two: Windows registry `HKCU\...\Run`).

**Python engine — `python-engine/`**
- WebSocket server on `localhost:9876` (see `config.py`). All UI ↔ engine comms are JSON messages over this socket; there is no HTTP surface.
- `main.py` does a managed-runtime preflight via `runtime_manager.ensure_and_reexec()` *before* heavy imports — if the host Python isn't in the supported range, it re-execs under the managed 3.12.
- `providers/` — every backend implements `BaseProvider` (load / transcribe / unload / stream_transcribe / transcribe_file). `providers/registry.py` holds a single active provider and swaps on model switch.
- Two wired providers today: `whisper_cpp_provider.py` (local, via bundled `whisper-cli` in `binaries/whisper-cpp/{cpu,cuda,vulkan,metal}/`) and `groq_provider.py` (cloud, user-supplied key). New providers: add a class, register in `_PROVIDER_CLASSES`, add catalog entries.
- `api_keys.py` stores the user's Groq key in the OS keyring (Credential Manager / Keychain), with a `secrets.json` fallback. `legacy_cleanup.py` runs once at boot to purge trial/auth state left by pre-open-source builds — keep it until those installs are gone.
- Model catalog is authoritative in `catalog.py` (`X_MODELS`). Hardware tiering / preset resolution lives in `hardware.py` + `presets.py`. Settings persisted by `settings_store.py` to `%APPDATA%\X-Whisper\config.json`.

**Frontend — `src/`**
- Single Vite entry (`main.tsx`) that dispatches on `?window=<label>` from `window.location.search` — every window loads the same bundle and picks its root component from `src/windows/{island,settings,onboarding,transcribe}/`.
- State: Zustand (`src/store/useAppStore.ts`) is the single store. `useWebSocket.ts` connects to `ws://localhost:9876`, `useGlobalHotkey.ts` wires the hotkey plugin, `useAutoPaste.ts` calls the `paste_text` Tauri command, `useEngineHealth.ts` polls engine liveness.

## Conventions specific to this repo

- **Open source, no accounts** — there is no login, trial, subscription, or backend. Cloud transcription is bring-your-own Groq key (Settings → Cloud). Don't reintroduce gating or phone-home calls.
- **Consumer app** — X-Whisper targets non-technical users. Favour clean defaults over tuning sliders; avoid exposing power-user knobs.
- **Windows + macOS** — every OS-specific path in `lib.rs` is behind `#[cfg(target_os = ...)]` (Job Object vs. ppid watchdog, registry vs. LaunchAgent startup, PowerShell vs. `pbcopy`/`osascript` paste). Linux is not wired up; `config.py` has a path branch but nothing else follows through.
- `binaries/` and the managed Python runtime are **not** committed — they're fetched per build and per first-launch respectively. Don't add files there to git.
- `imp_docs/` and `docs/superpowers/` are gitignored internal design notes — don't reference them from committed code or docs.
