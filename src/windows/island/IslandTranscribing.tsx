/**
 * X-Whisper — Island Transcribing State
 * Shows a spinner and "Transcribing..." text.
 */

import { Loader2 } from 'lucide-react';

export function IslandTranscribing() {
  return (
    <div className="flex items-center justify-center h-full px-4 gap-2.5">
      <Loader2 size={16} className="text-white/70 animate-spin" />
      <span className="text-sm font-medium text-white/80">
        Transcribing...
      </span>
    </div>
  );
}
