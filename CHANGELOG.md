# Changelog

All notable changes to X-Whisper are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- **X-Whisper is now open source under MIT.** The 15-minute trial, sign-in,
  and Pro subscription are gone — every install gets the full app.
- Cloud transcription is now bring-your-own-key: paste a Groq API key under
  Settings → Cloud. Nothing routes through an X-Studio server.
- Settings → About links to [x-studio.live](https://x-studio.live) and the
  GitHub repository.
- The idle island is a smaller, cleaner pill (90×28, was 180×44): logo
  and status dot only, no app name.
- The island is anchored to its top edge, so it sits at the top-centre of
  the screen and grows downward when it expands, instead of floating
  around a fixed centre point.

### Removed
- Auth window, tray "Account" entry, Settings → Account section, and the
  trial countdown badge on the island.

### Added
- Settings → General → **Dynamic Island**: choose *Always*, *While
  speaking* (pill appears when you record and hides after the result), or
  *Hidden*. The hotkey and auto-paste keep working in every mode.
- One-time cleanup on first launch that removes trial/session state left
  behind by earlier builds.
- `CONTRIBUTING.md`, `SECURITY.md`, issue and PR templates.
