/**
 * X-Whisper — Island Visibility
 *
 * Drives the native island window's show/hide from the
 * `islandVisibility` setting:
 *
 *   always    → window stays visible (default)
 *   speaking  → visible only while the pill has something to say
 *               (recording, transcribing, success flash, no-model CTA)
 *   hidden    → never shown; the webview keeps running so the global
 *               hotkey, WS connection and auto-paste still work
 *
 * Goes through the `set_island_visible` Rust command rather than
 * `getCurrentWindow().show()` because the latter activates the window
 * on Windows and would steal focus from the app being dictated into.
 *
 * The last known mode is mirrored into localStorage so a `speaking` /
 * `hidden` install doesn't flash the idle pill on launch during the
 * ~50 ms before the engine replays settings.
 */

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, type IslandVisibility } from './useAppStore';

const CACHE_KEY = 'xwhisper.island.visibility';

function readCachedMode(): IslandVisibility | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === 'always' || raw === 'speaking' || raw === 'hidden') return raw;
  } catch {
    /* storage unavailable */
  }
  return null;
}

function applyVisible(visible: boolean) {
  invoke('set_island_visible', { visible }).catch((e) =>
    console.warn('[Island] set_island_visible failed:', e),
  );
}

/**
 * @param active  whether the pill is currently showing a non-idle state
 */
export function useIslandVisibility(active: boolean) {
  const mode = useAppStore((s) => s.settings.islandVisibility);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);
  const onboardingCompleted = useAppStore((s) => s.settings.onboardingCompleted);
  const lastApplied = useRef<boolean | null>(null);

  // Before settings arrive, honour whatever mode this install last used
  // so a hidden/speaking island doesn't blink on at startup. First-run
  // installs have no cache and fall through to "always", which is also
  // what Rust expects while onboarding owns the window.
  useEffect(() => {
    const cached = readCachedMode();
    if (cached && cached !== 'always') {
      lastApplied.current = false;
      applyVisible(false);
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    // During first-run onboarding, Rust hides the island and shows it
    // when onboarding completes. Don't fight it.
    if (!onboardingCompleted) return;

    try {
      localStorage.setItem(CACHE_KEY, mode);
    } catch {
      /* ignore quota errors */
    }

    const visible = mode === 'always' || (mode === 'speaking' && active);
    if (lastApplied.current === visible) return;
    lastApplied.current = visible;
    applyVisible(visible);
  }, [mode, active, settingsLoaded, onboardingCompleted]);
}
