/**
 * X-Whisper Onboarding — Splash Step
 * Logo animation with a glowing pulse, auto-advances after 2.5s.
 */

import { useEffect } from 'react';
import { motion } from 'framer-motion';

interface SplashStepProps {
  onNext: () => void;
}

export function SplashStep({ onNext }: SplashStepProps) {
  useEffect(() => {
    const timer = setTimeout(onNext, 2500);
    return () => clearTimeout(timer);
  }, [onNext]);

  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full gap-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.5 }}
    >
      {/* Glowing logo */}
      <motion.div
        className="relative"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.2 }}
      >
        <div className="w-24 h-24 rounded-3xl overflow-hidden relative z-10">
          <img
            src="/logo.png"
            alt="X-Whisper"
            className="w-full h-full object-cover scale-[2.0]"
          />
        </div>
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-3xl animate-glow-pulse" />
      </motion.div>

      {/* App name */}
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold text-white tracking-tight">X-Whisper</h1>
        <p className="text-sm text-white/45 mt-2">Your voice, turned into text</p>
      </motion.div>

      {/* Subtle loading indicator */}
      <motion.div
        className="w-12 h-1 rounded-full overflow-hidden bg-white/10 mt-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        <motion.div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 2.0, delay: 0.5, ease: 'easeInOut' }}
        />
      </motion.div>
    </motion.div>
  );
}
