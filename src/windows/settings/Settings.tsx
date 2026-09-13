/**
 * X-Whisper — Settings Window
 * Sidebar + right-pane layout. Actual sections live in SettingsLayout.
 */

import React from 'react';
import { useWebSocket } from '../../store/useWebSocket';
import { SettingsLayout } from './SettingsLayout';

export function Settings() {
  useWebSocket();

  return (
    <div className="h-screen flex flex-col bg-[#0A0A0A] text-white">
      <div
        className="h-8 w-full flex-shrink-0 border-b border-white/[0.03]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="flex-1 min-h-0">
        <SettingsLayout />
      </div>
    </div>
  );
}
