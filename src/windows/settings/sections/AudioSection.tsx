/**
 * X-Whisper — Audio Settings Section
 * Placeholder for the input-device picker.
 */

import { AudioWaveform } from 'lucide-react';

export function AudioSection() {
  return (
    <div className="space-y-3">
      <div className="settings-card">
        <div className="flex items-center gap-2 mb-3">
          <AudioWaveform size={16} className="text-white/40" />
          <h2 className="text-sm font-semibold text-white/80">Input Device</h2>
        </div>
        <p className="text-[11px] text-white/40">
          Using the system default microphone. Device picker and VAD tuning come in a future update.
        </p>
      </div>
    </div>
  );
}
