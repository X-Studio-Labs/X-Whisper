/**
 * X-Whisper — Language Settings Section
 * Select transcription language or auto-detect.
 */

import { Globe } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useWebSocket } from '../../../store/useWebSocket';

const LANGUAGES = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ru', label: 'Russian' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'sv', label: 'Swedish' },
];

export function LanguageSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { sendCommand } = useWebSocket();

  const setLanguage = (lang: string) => {
    updateSettings({ language: lang });
    sendCommand('update_setting', { key: 'language', value: lang });
  };

  return (
    <div className="settings-card">
      <div className="flex items-center gap-2 mb-4">
        <Globe size={16} className="text-cyan-400" />
        <h2 className="text-sm font-semibold text-white/80">Language</h2>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm text-white/70">Transcription language</p>
          <p className="text-[10px] text-white/35">Select a language or let Whisper auto-detect</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className={`text-[11px] px-2 py-1.5 rounded-md transition-colors text-left ${
              settings.language === lang.code
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                : 'bg-white/[0.02] text-white/50 border border-white/[0.06] hover:bg-white/[0.06]'
            }`}
          >
            {lang.label}
          </button>
        ))}
      </div>
    </div>
  );
}
