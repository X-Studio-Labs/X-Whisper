/**
 * X-Whisper — Auto-paste Hook
 *
 * Automatically pastes transcribed text into the active window
 * using Tauri clipboard + enigo keyboard simulation. Suppressed
 * while the onboarding window is open — rehearsal needs the
 * transcript to appear in the onboarding window only, not the
 * user's last-focused app.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from './useAppStore';

export function useAutoPaste() {
  const lastTranscript = useAppStore((s) => s.lastTranscript);
  const prevTranscript = useRef('');

  useEffect(() => {
    if (lastTranscript && lastTranscript !== prevTranscript.current) {
      prevTranscript.current = lastTranscript;
      performPaste(lastTranscript);
    }
  }, [lastTranscript]);
}

async function isOnboardingOpen(): Promise<boolean> {
  try {
    const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
    const windows = await getAllWebviewWindows();
    return windows.some((w) => w.label === 'onboarding');
  } catch {
    return false;
  }
}

async function performPaste(text: string) {
  if (await isOnboardingOpen()) {
    console.log('[AutoPaste] Suppressed — onboarding active');
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('paste_text', { text });
    console.log('[AutoPaste] Text pasted successfully');
  } catch (e) {
    console.debug('[AutoPaste] Not available (browser mode):', e);
    try {
      await navigator.clipboard.writeText(text);
      console.log('[AutoPaste] Copied to clipboard (manual paste required)');
    } catch {
      console.error('[AutoPaste] All clipboard methods failed');
    }
  }
}
