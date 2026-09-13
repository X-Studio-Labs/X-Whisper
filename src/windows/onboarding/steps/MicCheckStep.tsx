/**
 * X-Whisper Onboarding — Mic Info Step
 *
 * Passive informational screen. We deliberately do NOT call
 * getUserMedia here — that would ambush the user with Windows'
 * native permission dialog mid-onboarding. The prompt is deferred
 * to the first real hotkey press, which is a moment the user is
 * already expecting it.
 */

import { motion } from 'framer-motion';
import { Mic, Lock, Zap } from 'lucide-react';

interface MicCheckStepProps {
  onNext: () => void;
}

export function MicCheckStep({ onNext }: MicCheckStepProps) {
  return (
    <motion.div
      className="flex flex-col h-full items-center px-10 pt-12 pb-20 gap-7"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Header */}
      <motion.div
        className="flex flex-col items-center gap-2.5 shrink-0"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <Mic size={20} className="text-blue-400" />
        </div>
        <h2 className="text-lg font-semibold text-white mt-1">Your voice, your device</h2>
        <p className="text-xs text-white/45 text-center max-w-[320px] leading-relaxed">
          X-Whisper listens only while you hold the hotkey.
        </p>
      </motion.div>

      {/* Info cards */}
      <div className="flex-1 flex flex-col items-stretch justify-center w-full gap-3.5">
        <motion.div
          className="flex items-start gap-3.5 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="w-8 h-8 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-[1px]">
            <Lock size={14} className="text-emerald-400" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-white/90">Stays on your device</span>
            <span className="text-[11px] text-white/50 leading-relaxed">
              Local models transcribe offline — audio never leaves your computer.
            </span>
          </div>
        </motion.div>

        <motion.div
          className="flex items-start gap-3.5 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          <div className="w-8 h-8 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-[1px]">
            <Zap size={14} className="text-blue-400" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-white/90">Press-to-talk, nothing else</span>
            <span className="text-[11px] text-white/50 leading-relaxed">
              The mic opens when you press the hotkey and closes the moment you release it.
            </span>
          </div>
        </motion.div>
      </div>

      <motion.p
        className="shrink-0 text-[10.5px] text-white/35 text-center leading-relaxed px-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.36 }}
      >
        {navigator.userAgent.includes('Mac') ? (
          <>
            macOS will ask for microphone access the first time you record.
            <br />
            It will also ask for Accessibility access the first time we paste
            transcribed text into another app.
          </>
        ) : (
          'Windows will ask for mic permission the first time you record.'
        )}
      </motion.p>

      {/* Footer */}
      <motion.button
        onClick={onNext}
        className="shrink-0 px-7 py-2.5 rounded-lg text-xs font-medium bg-white/[0.1] border border-white/[0.15] text-white hover:bg-white/[0.16] transition-all"
        whileTap={{ scale: 0.96 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.42 }}
      >
        Continue
      </motion.button>
    </motion.div>
  );
}
