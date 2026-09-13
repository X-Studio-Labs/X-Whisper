# Contributing to X-Whisper

Thanks for helping. This doc covers how the app is put together, how to run it locally, and what we look for in a PR.

## Ground rules

- **Consumer product.** X-Whisper is for people who don't want to configure anything. Prefer a good default over a new slider; if a knob is only useful to 2 % of users, it probably doesn't belong in Settings.
- **No accounts, no telemetry.** The app never phones home. Don't add analytics, update pings, or anything that needs a server we run. Cloud transcription is opt-in and uses the *user's* Groq key.
- **Windows and macOS both work.** If you touch `src-tauri/src/lib.rs` or the bootstrap scripts, keep the other platform's `#[cfg]` branch working — or say in the PR that you couldn't test it.
- Keep PRs focused. One feature or fix per PR makes review fast.

## Setup

Prereqs: **Node 20+**, **Rust stable** (`rustup`), **Python 3.12** for running the engine directly in dev, and on Windows **PowerShell 5.1+ / pwsh**.

```bash
git clone https://github.com/X-Studio-Labs/X-Whisper.git
cd X-Whisper
npm install

# Bundled binaries (gitignored; fetched per checkout)
pwsh build/fetch-whisper-cpp.ps1 && pwsh build/fetch-ffmpeg.ps1        # Windows: CPU + CUDA + Vulkan whisper-cli, ffmpeg
bash build/build-whisper-cpp-metal.sh && bash build/fetch-ffmpeg.sh   # macOS: Metal whisper-cli built from source, ffmpeg

npm run tauri dev
```

`npm run tauri dev` starts Vite on `:1420`, builds the Rust shell, and the shell spawns the Python engine. On first run the shell bootstraps a managed Python 3.12 under `%APPDATA%\X-Whisper\runtime\python\` (Windows) or `~/Library/Application Support/X-Whisper/runtime/python/` (macOS) and installs `python-engine/requirements.txt` into it.

### Useful commands

| Command | What |
|---|---|
| `npm run tauri dev` | Full dev loop |
| `npm run build` | `tsc && vite build` — run this before pushing, it's the TypeScript check |
| `./run_engine.ps1` / `bash run_engine.sh` | Run the engine alone under the managed runtime (`-BootstrapOnly`, `-Force` flags) |
| `cd src-tauri && cargo check` | Rust type-check (needs `binaries/` populated — tauri-build validates resource paths) |
| `npm run tauri build` | Installer → `src-tauri/target/release/bundle/` |

There's no test suite yet. `tsc`, `cargo check`, and a manual run through the hotkey flow are the bar.

## Architecture

Three processes; the UI never touches a model directly.

### Rust shell — `src-tauri/src/lib.rs`

- Spawns `python-engine/main.py` as a child. On Windows it's bound to a Job Object with `KILL_ON_JOB_CLOSE`; on macOS the engine polls `getppid()` and exits when the parent dies. Either way port 9876 is freed on quit.
- Owns four windows, created on demand by label: `island` (always-on-top overlay), `settings`, `onboarding`, `transcribe`. `preferred_*_size()` helpers size them relative to the monitor so every entry point lands identically.
- Tauri commands exposed to JS: `paste_text`, `open_settings`, `open_transcribe_window`, `save_text_file`, `engine_status`, `restart_engine`, `set_launch_at_startup`, `get_launch_at_startup`, `set_island_frame`.
- Every child `Command` goes through `hidden_command()` so nothing flashes a console on Windows.

### Python engine — `python-engine/`

- `main.py` — WebSocket server on `ws://localhost:9876`. Everything the UI does is a JSON `{cmd: ...}` message; the engine answers with `{event: ...}`. There is no HTTP.
- `runtime_manager.py` runs *before* heavy imports and re-execs under the managed 3.12 if the host interpreter is out of range.
- `providers/` — `BaseProvider` (`load` / `transcribe` / `transcribe_file` / `unload`, plus `stream_transcribe` for live partials). `registry.py` holds one active provider and swaps on model change.
- `catalog.py` — `X_MODELS`, the single source of truth for what models exist, their sizes, languages, and which provider serves them.
- `hardware.py` + `presets.py` — RAM/GPU probe → tier → preset → concrete model.
- `whisper_cpp_runtime.py` — picks the `whisper-cli` backend (cuda / vulkan / cpu / metal) and caches the decision.
- `settings_store.py` → `config.json`, `transcript_history.py` → `transcripts.json`, `api_keys.py` → OS keyring (Groq key).
- `legacy_cleanup.py` — one-shot removal of trial/auth state from pre-open-source installs. Leave it in until those builds are gone.

### Frontend — `src/`

- One Vite bundle. `main.tsx` reads `?window=<label>` and mounts the matching root from `src/windows/`.
- `store/useAppStore.ts` is the single Zustand store; `store/useWebSocket.ts` is the singleton socket + event → store mapping. Add new engine events there.
- Hooks: `useGlobalHotkey` (Tauri global-shortcut plugin), `useAutoPaste` (calls `paste_text`), `useEngineHealth` (ping loop + restart).

## Common changes

### Add a model

1. Add an entry to `X_MODELS` in `python-engine/catalog.py`. For whisper.cpp models, `ggml_file` is the asset name under `ggerganov/whisper.cpp` on Hugging Face.
2. If it should be preset-selectable, add it to the tier tables in `presets.py`.
3. That's it — Settings → Models and the download manager read the catalog.

### Add a provider

1. Create `python-engine/providers/<name>_provider.py` implementing `BaseProvider`. Look at `groq_provider.py` for the smallest example.
2. Register it in `_PROVIDER_CLASSES` in `providers/registry.py`.
3. Add catalog entries with `"provider": "<name>"`.
4. If it needs a credential, store it through `api_keys.py` and add a field to `src/windows/settings/sections/CloudSection.tsx` — never write secrets to `config.json`.

### Add a WebSocket command

1. Handle it in `handle_command()` in `main.py` and emit a reply event.
2. Map the reply in `handleEvent()` in `src/store/useWebSocket.ts`.
3. Call it from the UI with `sendCommand('your_cmd', {...})`.

## Pull requests

- Branch from `master`. Name it `feat/...`, `fix/...`, or `docs/...`.
- Run `npm run build` and the Rust check before pushing.
- Describe *what changed and why* in the PR body; screenshots for anything visual.
- Commit messages follow the existing style: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`.

## Reporting bugs

Open an issue with the template. Engine logs are at `%APPDATA%\X-Whisper\logs\engine.log` (Windows) or `~/Library/Application Support/X-Whisper/logs/engine.log` (macOS) — attach the tail of that if the problem is in transcription or model loading.
