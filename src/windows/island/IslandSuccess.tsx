/**
 * X-Whisper — Island Success State
 * Shows briefly after successful transcription with a checkmark and truncated text.
 */

import { Check } from 'lucide-react';

interface IslandSuccessProps {
  text: string;
}

export function IslandSuccess({ text }: IslandSuccessProps) {
  // Truncate text for display
  const displayText = text.length > 40 ? text.substring(0, 40) + '...' : text;

  return (
    <div className="flex items-center h-full px-4 gap-2.5">
      <div className="w-5 h-5 rounded-full bg-[#30D158]/20 flex items-center justify-center flex-shrink-0">
        <Check size={12} className="text-[#30D158]" />
      </div>
      <span className="text-xs text-white/70 truncate">
        {displayText}
      </span>
    </div>
  );
}
