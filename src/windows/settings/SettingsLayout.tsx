/**
 * X-Whisper — Settings Layout
 * Sidebar + right-pane shell for the settings window. Section switching is
 * driven by the `activeSection` slice of the global store.
 */

import { Settings as SettingsIcon, HardDrive, Cloud, Keyboard, AudioWaveform, Palette, Info, History, FileAudio, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { useAppStore, SettingsSection } from '../../store/useAppStore';
import { ModelManagerSection } from './sections/ModelManagerSection';
import { HotkeySection } from './sections/HotkeySection';
import { BehaviorSection } from './sections/BehaviorSection';
import { AboutSection } from './sections/AboutSection';
import { CloudSection } from './sections/CloudSection';
import { AudioSection } from './sections/AudioSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { HistorySection } from './sections/HistorySection';

type NavItem = { id: SettingsSection; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'models', label: 'Models', icon: HardDrive },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'hotkey', label: 'Hotkey', icon: Keyboard },
  { id: 'history', label: 'History', icon: History },
  { id: 'audio', label: 'Audio', icon: AudioWaveform },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'about', label: 'About', icon: Info },
];

async function openTranscribeFile() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_transcribe_window');
  } catch (e) {
    console.debug('[Settings] Transcribe window not available (browser mode)', e);
  }
}

function renderSection(section: SettingsSection) {
  switch (section) {
    case 'general': return <BehaviorSection />;
    case 'models': return <ModelManagerSection />;
    case 'cloud': return <CloudSection />;
    case 'hotkey': return <HotkeySection />;
    case 'history': return <HistorySection />;
    case 'audio': return <AudioSection />;
    case 'appearance': return <AppearanceSection />;
    case 'about': return <AboutSection />;
  }
}

export function SettingsLayout() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const activeLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? 'Settings';

  return (
    <div className="flex h-full">
      <nav className="w-44 flex-shrink-0 border-r border-white/[0.04] bg-black/20 p-2 space-y-0.5 overflow-y-auto">
        <div className="flex items-center gap-2 px-2 py-2 mb-1">
          <div className="w-7 h-7 rounded-md overflow-hidden border border-white/[0.06] flex items-center justify-center bg-black/20">
            <img src="/logo.png" alt="X-Whisper" className="w-full h-full object-cover scale-[2.0]" />
          </div>
          <div className="text-[13px] font-semibold text-white/80">X-Whisper</div>
        </div>
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors text-[13px] ${
                isActive
                  ? 'bg-white/[0.08] text-white'
                  : 'text-white/55 hover:bg-white/[0.04] hover:text-white/80'
              }`}
            >
              <Icon size={14} className={isActive ? 'text-white/90' : 'text-white/50'} />
              <span>{label}</span>
            </button>
          );
        })}

        <div className="h-px bg-white/[0.04] my-2 mx-2" />

        <button
          onClick={openTranscribeFile}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors text-[13px] text-white/55 hover:bg-white/[0.04] hover:text-white/80 group"
          title="Open file transcription in a new window"
        >
          <FileAudio size={14} className="text-white/50 group-hover:text-white/80" />
          <span className="flex-1">Transcribe file</span>
          <ArrowUpRight size={12} className="text-white/30 group-hover:text-white/60" />
        </button>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[640px] mx-auto px-6 py-6">
          <h1 className="text-[15px] font-semibold text-white/85 mb-4">{activeLabel}</h1>
          {renderSection(activeSection)}
        </div>
      </main>
    </div>
  );
}
