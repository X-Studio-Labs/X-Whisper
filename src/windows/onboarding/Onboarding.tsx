/**
 * X-Whisper — Onboarding Window
 * 4-step experiential flow with Dynamic Island style morphing animations.
 * Splash → Language → Mic check → Complete
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { SplashStep } from './steps/SplashStep';
import { LanguageStep } from './steps/LanguageStep';
import { MicCheckStep } from './steps/MicCheckStep';
import { CompleteStep } from './steps/CompleteStep';
import { SettingUpStep } from './steps/SettingUpStep';
import { wsManager } from '../../store/useWebSocket';
import { useAppStore } from '../../store/useAppStore';

const TOTAL_STEPS = 4;

interface StepSize {
  width: number;
  height: number;
}

// Dynamic Island style spring
const pillSpring = {
  type: 'spring' as const,
  stiffness: 350,
  damping: 30,
  mass: 0.8,
};

// Default step dimensions — steps can override via `onResize`.
const stepSizes: Record<number, StepSize> = {
  0: { width: 380, height: 360 }, // Splash
  1: { width: 420, height: 410 }, // Language (card mode default; grid mode overrides)
  2: { width: 480, height: 560 }, // Mic check
  3: { width: 420, height: 440 }, // Complete — celebration + startup toggle
};

// Size for the "Setting up" waiting screen (only shown when engine
// bootstrap hasn't finished by the time the user clicks Get Started).
const SETUP_SIZE: StepSize = { width: 420, height: 400 };

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [sizeOverride, setSizeOverride] = useState<StepSize | null>(null);
  const [finishing, setFinishing] = useState(false);
  const connectionStatus = useAppStore((s) => s.connectionStatus);

  // Open the engine connection as soon as the window mounts so the
  // Language step can prefetch the model in the background.
  useEffect(() => {
    wsManager.connect();
  }, []);

  // Reset the per-step size override whenever the step changes, so the
  // next step starts from its own default rather than inheriting.
  useEffect(() => {
    setSizeOverride(null);
  }, [step]);

  const nextStep = useCallback(() => {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const prevStep = useCallback(() => {
    setStep((s) => Math.max(s - 1, 1)); // Can't go back to splash
  }, []);

  // Actually tears down the window + hands off to the island. Called
  // once the engine is known to be reachable.
  const finalizeOnboarding = useCallback(async () => {
    try {
      wsManager.send({ cmd: 'complete_onboarding' });
    } catch { /* engine may have died — fall through and emit anyway */ }

    // Small settle so the command flushes before we tear the window down.
    setTimeout(async () => {
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('onboarding_complete');
      } catch {
        try {
          const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
          const win = getCurrentWebviewWindow();
          await win.close();
        } catch { /* noop */ }
      }
    }, 200);
  }, []);

  // Called when the user clicks Get Started. If the engine is already
  // up (common — bootstrap finishes within the time it takes to click
  // through the four steps), hand off immediately. Otherwise flip into
  // `finishing` mode so the SettingUpStep renders while we wait for the
  // WebSocket to connect.
  const handleFinish = useCallback(() => {
    if (wsManager.isConnected) {
      finalizeOnboarding();
      return;
    }
    setFinishing(true);
  }, [finalizeOnboarding]);

  // While we're in finishing mode, fire the real finish sequence the
  // moment the engine connects. The store's connectionStatus flips to
  // 'connected' as soon as the WS handshake completes.
  useEffect(() => {
    if (finishing && connectionStatus === 'connected') {
      finalizeOnboarding();
    }
  }, [finishing, connectionStatus, finalizeOnboarding]);

  const defaultSize = finishing ? SETUP_SIZE : (stepSizes[step] || stepSizes[0]);
  const width = sizeOverride?.width ?? defaultSize.width;
  const height = sizeOverride?.height ?? defaultSize.height;

  // Back arrow on middle steps only (not splash, not complete, not setup).
  const showBack = !finishing && step > 0 && step < TOTAL_STEPS - 1;
  // Progress dots on middle steps only.
  const showDots = !finishing && step > 0 && step < TOTAL_STEPS - 1;

  return (
    <div
      className="flex items-center justify-center w-screen h-screen select-none"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Dynamic Island morphing card */}
      <motion.div
        className="relative rounded-3xl border border-white/[0.08] overflow-hidden"
        style={{
          background: 'rgba(18, 18, 20, 0.95)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          boxShadow: '0 25px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
        }}
        animate={{ width, height }}
        transition={pillSpring}
      >
        {/* Step content */}
        <AnimatePresence mode="wait">
          {finishing ? (
            <motion.div key="setup" className="w-full h-full">
              <SettingUpStep />
            </motion.div>
          ) : (
            <>
              {step === 0 && (
                <motion.div key="splash" className="w-full h-full">
                  <SplashStep onNext={nextStep} />
                </motion.div>
              )}
              {step === 1 && (
                <motion.div key="language" className="w-full h-full">
                  <LanguageStep onNext={nextStep} onResize={setSizeOverride} />
                </motion.div>
              )}
              {step === 2 && (
                <motion.div key="miccheck" className="w-full h-full">
                  <MicCheckStep onNext={nextStep} />
                </motion.div>
              )}
              {step === 3 && (
                <motion.div key="complete" className="w-full h-full">
                  <CompleteStep onFinish={handleFinish} />
                </motion.div>
              )}
            </>
          )}
        </AnimatePresence>

        {/* Back affordance — top-left */}
        {showBack && (
          <motion.button
            onClick={prevStep}
            className="absolute top-3.5 left-3.5 flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] text-white/35 hover:text-white/80 hover:bg-white/[0.06] transition-all z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            whileTap={{ scale: 0.95 }}
          >
            <ChevronLeft size={11} />
            Back
          </motion.button>
        )}

        {/* Progress dots — bottom-center */}
        {showDots && (
          <motion.div
            className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-1.5 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <motion.div
                key={i}
                className="rounded-full"
                animate={{
                  width: i === step ? 16 : 5,
                  height: 5,
                  backgroundColor: i === step ? 'rgba(59, 130, 246, 0.8)' : 'rgba(255,255,255,0.15)',
                }}
                transition={pillSpring}
              />
            ))}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
