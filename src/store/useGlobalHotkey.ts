/**
 * X-Whisper — Global Hotkey Hook
 * 
 * Manages global keyboard shortcuts via @tauri-apps/plugin-global-shortcut.
 * Default hotkey: Ctrl+Shift+Space (toggle record mode)
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from './useAppStore';
import { wsManager } from './useWebSocket';

const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

export function useGlobalHotkey() {
  const isRegistered = useRef(false);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    async function registerHotkey() {
      try {
        const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut');

        // Register the global shortcut
        await register(DEFAULT_HOTKEY, async (event) => {
          if (event.state === 'Pressed') {
            const currentState = useAppStore.getState().appState;

            if (currentState === 'idle') {
              // Start recording
              wsManager.send({ cmd: 'start_recording' });
            } else if (currentState === 'recording') {
              // Stop recording → will trigger transcription
              wsManager.send({ cmd: 'stop_recording' });
            }
            // Ignore if transcribing — wait for it to finish
          }
        });

        isRegistered.current = true;
        console.log(`[Hotkey] Registered: ${DEFAULT_HOTKEY}`);

        cleanup = () => {
          unregister(DEFAULT_HOTKEY).catch(() => {});
          isRegistered.current = false;
          console.log(`[Hotkey] Unregistered: ${DEFAULT_HOTKEY}`);
        };
      } catch (e) {
        console.debug('[Hotkey] Not available (browser mode)');
      }
    }

    registerHotkey();

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return { hotkey: DEFAULT_HOTKEY };
}
