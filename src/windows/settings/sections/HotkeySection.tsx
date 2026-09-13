/**
 * X-Whisper — Hotkey Settings Section
 * Configure keyboard shortcuts for recording toggle.
 */

import { Keyboard } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';

export function HotkeySection() {
  const settings = useAppStore((s) => s.settings);

  return (
    <div className="settings-card">
      <div className="flex items-center gap-2 mb-4">
        <Keyboard size={16} className="text-purple-400" />
        <h2 className="text-sm font-semibold text-white/80">Hotkey</h2>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/70">Toggle Recording</p>
          <p className="text-[10px] text-white/35 mt-0.5">Press to start, press again to stop and transcribe</p>
        </div>
        <div className="flex items-center gap-1">
          {settings.hotkey.split('+').map((key, i) => (
            <span key={i}>
              {i > 0 && <span className="text-white/15 mx-0.5">+</span>}
              <kbd className="text-[11px] px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.1] text-white/60 font-mono">{key}</kbd>
            </span>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-white/25 mt-3 italic">
        Custom hotkey configuration coming in a future update
      </p>
    </div>
  );
}
