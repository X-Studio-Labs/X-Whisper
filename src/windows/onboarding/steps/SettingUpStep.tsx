/**
 * X-Whisper Onboarding — Setting Up Step
 *
 * Shown after "Get Started" when the Python engine's first-launch
 * bootstrap (pip install of the managed runtime) hasn't finished.
 * Rotates through a small tip list while an indeterminate bar
 * and concentric pulse rings provide motion. Dismisses itself
 * upstream as soon as the WebSocket connects.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

const TIPS = [
  'Talk instead of type — in any app on your computer.',
  'Press your hotkey in emails, docs, chats, search bars — anywhere.',
  'Your voice stays on your device. Nothing is uploaded.',
  'Works fully offline once set up — no internet required.',
  'Drop in an MP3, MP4, or voice memo to get a transcript in seconds.',
  'Switch between 100+ languages on the fly.',
  'Change your hotkey anytime from Settings.',
  'Your last 50 transcripts are saved for quick recall.',
  'Capture meeting notes, voice memos, and ideas without lifting a finger.',
  'Press-to-talk: the mic only opens while you hold the hotkey.',
  'Great for writers, creators, support teams — anyone who types a lot.',
  'Almost ready — grab a sip of coffee while we finish up.',
];

export function SettingUpStep() {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full px-10 pt-10 pb-10 gap-6"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Animated glyph — concentric pulses + spinning ring */}
      <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full border border-blue-400/25"
          animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute inset-0 rounded-full border border-blue-400/15"
          animate={{ scale: [1, 1.9, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
        />
        <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center">
          <Loader2 size={24} className="text-blue-300 animate-spin" />
        </div>
      </div>

      {/* Title + rotating tip */}
      <div className="flex flex-col items-center gap-2 shrink-0 text-center">
        <h2 className="text-lg font-semibold text-white">Setting up X-Whisper</h2>
        <div className="h-[34px] flex items-center justify-center overflow-hidden">
          <motion.p
            key={tipIndex}
            className="text-[11.5px] text-white/55 leading-relaxed max-w-[300px]"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35 }}
          >
            {TIPS[tipIndex]}
          </motion.p>
        </div>
      </div>

      {/* Indeterminate progress bar */}
      <div className="w-full max-w-[280px] h-[3px] rounded-full bg-white/[0.06] overflow-hidden shrink-0">
        <motion.div
          className="h-full w-[40%] rounded-full bg-gradient-to-r from-transparent via-blue-400/80 to-transparent"
          animate={{ x: ['-100%', '250%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <p className="text-[10px] text-white/35 text-center leading-relaxed max-w-[280px] shrink-0">
        First-time setup can take a minute or two. Feel free to leave this window open.
      </p>
    </motion.div>
  );
}
