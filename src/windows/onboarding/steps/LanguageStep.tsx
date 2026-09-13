/**
 * X-Whisper Onboarding — Language Step
 *
 * Reads the OS locale (via `navigator.language`, which WebView2 forwards
 * from Windows) and pre-selects a language. Most users confirm with one
 * tap. Tapping "Change language" swaps the card inline into an
 * 18-language grid.
 *
 * The step reports its preferred window size via `onResize` so the
 * compact card view doesn't float in the larger grid-sized window.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, ChevronRight } from 'lucide-react';
import { wsManager } from '../../../store/useWebSocket';

interface LanguageStepProps {
  onNext: () => void;
  onResize?: (size: { width: number; height: number }) => void;
}

interface LangEntry {
  code: string;
  label: string;
  flag: string;
}

const LANGUAGES: LangEntry[] = [
  { code: 'en', label: 'English',    flag: 'EN' },
  { code: 'es', label: 'Spanish',    flag: 'ES' },
  { code: 'fr', label: 'French',     flag: 'FR' },
  { code: 'de', label: 'German',     flag: 'DE' },
  { code: 'it', label: 'Italian',    flag: 'IT' },
  { code: 'pt', label: 'Portuguese', flag: 'PT' },
  { code: 'nl', label: 'Dutch',      flag: 'NL' },
  { code: 'ja', label: 'Japanese',   flag: 'JA' },
  { code: 'ko', label: 'Korean',     flag: 'KO' },
  { code: 'zh', label: 'Chinese',    flag: 'ZH' },
  { code: 'hi', label: 'Hindi',      flag: 'HI' },
  { code: 'ar', label: 'Arabic',     flag: 'AR' },
  { code: 'ru', label: 'Russian',    flag: 'RU' },
  { code: 'pl', label: 'Polish',     flag: 'PL' },
  { code: 'tr', label: 'Turkish',    flag: 'TR' },
  { code: 'sv', label: 'Swedish',    flag: 'SV' },
  { code: 'uk', label: 'Ukrainian',  flag: 'UK' },
  { code: 'vi', label: 'Vietnamese', flag: 'VI' },
];

const DEFAULT_LANG = 'en';
const LANG_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

const CARD_SIZE = { width: 420, height: 410 };
const GRID_SIZE = { width: 500, height: 490 };

function detectSystemLanguage(): { code: string; fromOs: boolean } {
  const candidates: string[] = [];
  if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  if (navigator.language) candidates.push(navigator.language);

  for (const raw of candidates) {
    const short = raw.split(/[-_]/)[0].toLowerCase();
    if (LANG_BY_CODE[short]) return { code: short, fromOs: true };
  }
  return { code: DEFAULT_LANG, fromOs: false };
}

export function LanguageStep({ onNext, onResize }: LanguageStepProps) {
  const [detected, setDetected] = useState<{ code: string; fromOs: boolean } | null>(null);
  const [selected, setSelected] = useState<string>(DEFAULT_LANG);
  const [showGrid, setShowGrid] = useState(false);
  const detectingRef = useRef(false);

  useEffect(() => {
    if (detectingRef.current) return;
    detectingRef.current = true;
    const d = detectSystemLanguage();
    setDetected(d);
    setSelected(d.code);
  }, []);

  // Tell the orchestrator which window size to use for the current view.
  useEffect(() => {
    onResize?.(showGrid ? GRID_SIZE : CARD_SIZE);
  }, [showGrid, onResize]);

  const pickInGrid = (code: string) => setSelected(code);

  const handleContinue = () => {
    const code = selected;
    const model = code === 'en' ? 'x-small-en' : 'x-turbo';
    wsManager.send({ cmd: 'update_setting', key: 'language', value: code });
    wsManager.send({ cmd: 'update_setting', key: 'model', value: model });
    wsManager.send({ cmd: 'download_model', model });
    onNext();
  };

  const selectedEntry = LANG_BY_CODE[selected] ?? LANG_BY_CODE[DEFAULT_LANG];
  const detectedLabel = detected?.fromOs ? 'Detected from your system' : 'Default';

  return (
    <motion.div
      className="flex flex-col h-full items-center px-8 pt-11 pb-20"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Header */}
      <motion.div
        className="flex flex-col items-center gap-1.5 shrink-0"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Globe size={18} className="text-cyan-400" />
        </div>
        <h2 className="text-lg font-semibold text-white mt-1">What do you speak?</h2>
        <p className="text-[11px] text-white/45 text-center max-w-[320px] leading-relaxed">
          {showGrid
            ? 'Pick your primary language. You can change it later in Settings.'
            : detectedLabel}
        </p>
      </motion.div>

      {/* Main — fills available vertical space and centers its child */}
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <AnimatePresence mode="wait">
          {showGrid ? (
            <motion.div
              key="grid"
              className="grid grid-cols-3 gap-2 w-full max-w-[420px]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {LANGUAGES.map((lang, i) => {
                const isSelected = selected === lang.code;
                return (
                  <motion.button
                    key={lang.code}
                    onClick={() => pickInGrid(lang.code)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-white'
                        : 'bg-white/[0.02] border-white/[0.06] text-white/55 hover:bg-white/[0.05] hover:text-white/80'
                    }`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.012, duration: 0.18 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    <span
                      className={`text-[9px] font-mono font-semibold tracking-wide shrink-0 ${
                        isSelected ? 'text-cyan-300' : 'text-white/35'
                      }`}
                    >
                      {lang.flag}
                    </span>
                    <span className="text-[11px] font-medium truncate">{lang.label}</span>
                  </motion.button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="card"
              className="flex flex-col items-center gap-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <div className="flex flex-col items-center gap-1.5 px-9 py-4 rounded-2xl bg-cyan-500/[0.08] border border-cyan-500/30">
                <span className="text-[11px] font-mono font-semibold text-cyan-300 tracking-wider">
                  {selectedEntry.flag}
                </span>
                <span className="text-xl font-semibold text-white">
                  {selectedEntry.label}
                </span>
              </div>
              <button
                onClick={() => setShowGrid(true)}
                className="text-[11px] text-white/45 hover:text-white/75 flex items-center gap-0.5 transition-colors"
              >
                Change language
                <ChevronRight size={11} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <motion.button
        onClick={handleContinue}
        disabled={!detected}
        className={`shrink-0 px-6 py-2 rounded-lg text-xs font-medium transition-all ${
          detected
            ? 'bg-white/[0.1] border border-white/[0.15] text-white hover:bg-white/[0.16]'
            : 'bg-white/[0.03] border border-white/[0.06] text-white/30 cursor-not-allowed'
        }`}
        whileTap={detected ? { scale: 0.96 } : {}}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        Continue
      </motion.button>
    </motion.div>
  );
}
