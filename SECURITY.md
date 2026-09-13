# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private reporting: **Security → Report a vulnerability** on
<https://github.com/X-Studio-Labs/X-Whisper>. If that's unavailable, email
the maintainers via the contact on <https://x-studio.live>.

Include what you found, how to reproduce it, and which version / OS you
tested on. We'll acknowledge within a few days and keep you updated until
it's fixed.

## Scope

Things we'd like to hear about:

- Anything that lets another local process or a crafted file read the
  user's Groq key, transcripts, or audio.
- The engine's WebSocket (`localhost:9876`) accepting commands it
  shouldn't, or from where it shouldn't.
- Bundled binaries (`whisper-cli`, `ffmpeg`) being invoked with
  attacker-controlled arguments.
- The first-launch runtime bootstrap (`bootstrap.ps1` / `bootstrap.sh`)
  fetching or executing something it shouldn't.
- Auto-paste being triggered into a window the user didn't intend.

Out of scope: issues in whisper.cpp, FFmpeg, or Groq themselves (report
upstream), and anything requiring an already-compromised machine.

## Supported versions

Only the latest release gets security fixes.
