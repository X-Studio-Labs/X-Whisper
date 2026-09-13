/**
 * X-Whisper — Appearance Settings Section
 * Theme, island position, and language. Theme + island position are stubs
 * for now — they land when the Rust side grows the matching commands.
 */

import { Palette, Moon, Sun, Monitor } from 'lucide-react';
import { LanguageSection } from './LanguageSection';

type IslandPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const ISLAND_POSITIONS: { id: IslandPosition; label: string }[] = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

export function AppearanceSection() {
  return (
    <div className="space-y-3">
      <ThemeCard />
      <IslandPositionCard />
      <LanguageSection />
    </div>
  );
}

function ThemeCard() {
  return (
    <div className="settings-card">
      <div className="flex items-center gap-2 mb-3">
        <Palette size={16} className="text-pink-400" />
        <h2 className="text-sm font-semibold text-white/80">Theme</h2>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ThemeTile icon={<Moon size={14} />} label="Dark" active />
        <ThemeTile icon={<Sun size={14} />} label="Light" disabled />
        <ThemeTile icon={<Monitor size={14} />} label="System" disabled />
      </div>
      <p className="text-[10px] text-white/25 mt-3 italic">
        Light and system themes coming in a future update.
      </p>
    </div>
  );
}

function ThemeTile({
  icon,
  label,
  active = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 py-2 rounded-md border text-[11px] transition-colors ${
        active
          ? 'bg-pink-500/10 text-pink-300 border-pink-500/30'
          : disabled
          ? 'bg-white/[0.02] text-white/20 border-white/[0.04] cursor-not-allowed'
          : 'bg-white/[0.03] text-white/55 border-white/[0.06] hover:bg-white/[0.06]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function IslandPositionCard() {
  return (
    <div className="settings-card">
      <div className="flex items-center gap-2 mb-3">
        <Palette size={16} className="text-cyan-400" />
        <h2 className="text-sm font-semibold text-white/80">Island Position</h2>
      </div>
      <p className="text-[11px] text-white/35 mb-3">
        Where the recording indicator sits on screen.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {ISLAND_POSITIONS.map((pos) => (
          <button
            key={pos.id}
            disabled
            className="py-2 rounded-md border text-[11px] bg-white/[0.02] text-white/25 border-white/[0.04] cursor-not-allowed"
          >
            {pos.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-white/25 mt-3 italic">
        Position control coming in a future update. For now the island lives at the bottom center.
      </p>
    </div>
  );
}
