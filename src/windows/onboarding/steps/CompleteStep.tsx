/**
 * X-Whisper Onboarding — Complete Step
 * Celebration screen with startup toggle + confetti burst on exit.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Check } from 'lucide-react';

interface CompleteStepProps {
  onFinish: () => void;
}

// Pre-generate confetti data so it's stable across renders
const confettiPieces = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  const distance = 90 + Math.random() * 80;
  const colors = ['#FF3B30', '#FF9500', '#FFCC00', '#30D158', '#0A84FF', '#BF5AF2', '#FF2D55', '#5AC8FA'];
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    size: 5 + Math.random() * 5,
    color: colors[i % colors.length],
    delay: i * 0.025,
    rotation: Math.random() * 360,
  };
});

async function setLaunchAtStartup(enabled: boolean) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_launch_at_startup', { enabled });
  } catch (e) {
    console.debug('[CompleteStep] set_launch_at_startup unavailable:', e);
  }
}

export function CompleteStep({ onFinish }: CompleteStepProps) {
  const [exiting, setExiting] = useState(false);
  const [autostart, setAutostart] = useState(true);

  // Default is ON — persist immediately so closing without toggling still sticks.
  useEffect(() => {
    setLaunchAtStartup(true);
  }, []);

  const toggleAutostart = () => {
    const next = !autostart;
    setAutostart(next);
    setLaunchAtStartup(next);
  };

  const handleClick = () => {
    if (exiting) return;
    setExiting(true);
    setTimeout(onFinish, 900);
  };

  return (
    <div className="relative w-full h-full overflow-visible">
      <div className="flex flex-col items-center h-full px-8 pt-10 pb-10 relative z-10">
        {/* Success icon */}
        <motion.div
          className="relative shrink-0"
          initial={{ scale: 0 }}
          animate={exiting
            ? { scale: 1.5, opacity: 0 }
            : { scale: 1, opacity: 1 }
          }
          transition={exiting
            ? { duration: 0.5 }
            : { type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }
          }
        >
          <div className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center">
            <motion.div
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.3 }}
            >
              <Check size={28} className="text-green-400" strokeWidth={3} />
            </motion.div>
          </div>
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-green-400/30"
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-0 rounded-2xl border border-green-400/15"
            initial={{ scale: 1, opacity: 0.3 }}
            animate={{ scale: [1, 1.8, 1], opacity: [0.3, 0, 0.3] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          />
        </motion.div>

        {/* Text */}
        <motion.div
          className="text-center shrink-0 mt-5"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
        >
          <h2 className="text-2xl font-bold text-white">You're all set</h2>
          <p className="text-[13px] text-white/50 mt-2 max-w-[300px] leading-relaxed">
            Press <span className="text-white/80 font-medium">Ctrl + Shift + Space</span> in any app and start talking.
          </p>
        </motion.div>

        {/* Main — absorbs remaining space and centers the toggle */}
        <div className="flex-1 flex items-center justify-center w-full">
          <motion.div
            className="flex items-center justify-between w-full max-w-[300px] px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
          >
            <div className="flex flex-col">
              <span className="text-[12.5px] font-medium text-white/90">Launch at startup</span>
              <span className="text-[10.5px] text-white/45 leading-tight mt-0.5">Always ready to listen</span>
            </div>
            <button
              onClick={toggleAutostart}
              disabled={exiting}
              aria-pressed={autostart}
              className="relative w-10 h-[22px] rounded-full transition-colors shrink-0"
              style={{
                background: autostart ? 'rgba(48,209,88,0.85)' : 'rgba(255,255,255,0.14)',
              }}
            >
              <motion.div
                className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow"
                animate={{ left: autostart ? 22 : 3 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            </button>
          </motion.div>
        </div>

        {/* Start button */}
        <motion.button
          onClick={handleClick}
          disabled={exiting}
          className="shrink-0 flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white/[0.1] border border-white/[0.14] text-white font-medium text-sm hover:bg-white/[0.16] transition-all disabled:pointer-events-none"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <Sparkles size={14} />
          <span>Get Started</span>
        </motion.button>
      </div>

      {/* Confetti burst */}
      {exiting && (
        <div className="absolute inset-0 pointer-events-none overflow-visible z-20">
          {confettiPieces.map((piece, i) => (
            <motion.div
              key={i}
              className="absolute rounded-sm"
              style={{
                width: piece.size,
                height: piece.size,
                backgroundColor: piece.color,
                left: '50%',
                top: '45%',
                marginLeft: -piece.size / 2,
                marginTop: -piece.size / 2,
              }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
              animate={{
                x: piece.x,
                y: piece.y,
                opacity: 0,
                scale: 0.2,
                rotate: piece.rotation,
              }}
              transition={{
                duration: 0.8,
                ease: [0.2, 0, 0, 1],
                delay: piece.delay,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
