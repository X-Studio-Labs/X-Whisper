/**
 * X-Whisper — Dynamic Island Component
 * 
 * The main floating overlay component that shows app state.
 * Animates between idle, recording, transcribing, success, and hover states.
 * The Tauri window is a fixed size — the island pill animates smoothly inside it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../store/useWebSocket';
import { useGlobalHotkey } from '../../store/useGlobalHotkey';
import { useAutoPaste } from '../../store/useAutoPaste';
import { useEngineHealth } from '../../store/useEngineHealth';
import { useIslandVisibility } from '../../store/useIslandVisibility';
import { IslandIdle } from './IslandIdle';
import { IslandRecording } from './IslandRecording';
import { IslandTranscribing } from './IslandTranscribing';
import { IslandHover } from './IslandHover';
import { IslandSuccess } from './IslandSuccess';
import { IslandNoModel } from './IslandNoModel';

// ── Animation Config ─────────────────────────────────────────

const islandSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
};

const widths: Record<string, number> = {
  idle: 90,
  recording: 340,
  transcribing: 280,
  success: 320,
  noModel: 340,
  hoverExpanded: 480,
};

const heights: Record<string, number> = {
  idle: 28,
  recording: 72,
  transcribing: 56,
  success: 60,
  noModel: 68,
  hoverExpanded: 140,
};

// ── Component ────────────────────────────────────────────────

export function Island() {
  const appState = useAppStore((s) => s.appState);
  const isHovered = useAppStore((s) => s.isHovered);
  const setIsHovered = useAppStore((s) => s.setIsHovered);
  const lastTranscript = useAppStore((s) => s.lastTranscript);
  const noModelCTA = useAppStore((s) => s.noModelCTA);
  const modelReady = useAppStore((s) => s.modelReady);
  const { connectionStatus } = useWebSocket();
  useGlobalHotkey();
  useAutoPaste();
  useEngineHealth();
  
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Show success state briefly after transcription
  useEffect(() => {
    if (lastTranscript && appState === 'idle') {
      setShowSuccess(true);
      if (successTimer.current) clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => {
        setShowSuccess(false);
      }, 3000);
    }
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [lastTranscript, appState]);

  // Disable hover-to-expand during recording so controls (e.g. stop button) remain clickable
  const hoverActive = isHovered && appState !== 'recording';

  // Surface the first-run CTA only when we're genuinely idle and no
  // model is ready — never while recording/transcribing.
  const showNoModel =
    !!noModelCTA && !modelReady && appState !== 'recording' && appState !== 'transcribing';

  // Determine current visual state
  const visualState = hoverActive
    ? 'hoverExpanded'
    : showSuccess
    ? 'success'
    : showNoModel
    ? 'noModel'
    : appState === 'error'
    ? 'idle'
    : appState;

  const currentWidth = widths[visualState] || widths.idle;
  const currentHeight = heights[visualState] || heights.idle;

  // Native show/hide per the "Dynamic Island" setting. Anything other
  // than the collapsed idle pill counts as "speaking".
  useIslandVisibility(visualState !== 'idle');

  // Match the native window's frame to the pill's current size so
  // transparent margins around the pill don't capture clicks. We go
  // through a single Rust command (`set_island_frame`) instead of the
  // JS setSize / setPosition pair because those are two separate async
  // OS calls — the intermediate frame (new size, old position) was
  // briefly mis-positioning the pill on screen, triggering mouseLeave
  // and causing a hover-oscillation loop. AppKit's
  // `NSWindow.setFrame:display:animate:` updates frame atomically.
  // User-preferred anchor: the pill's horizontal centre and its TOP
  // edge, in logical points from the top-left of the primary screen.
  // Anchoring on the top edge (not the centre) is what makes this feel
  // like a Dynamic Island — every state change grows or shrinks the
  // pill downward from the same spot, so the compact idle pill hugs the
  // top of the screen instead of floating where a taller state's centre
  // used to be. Loaded from localStorage on mount; updated when the user
  // drags the pill; consumed by every set_island_frame call.
  const PREF_KEY = 'xwhisper.island.anchor';
  const anchorRef = useRef<{ x: number; top: number } | null>(null);
  const [anchorReady, setAnchorReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.top === 'number') {
          anchorRef.current = { x: parsed.x, top: parsed.top };
        }
      }
    } catch {
      /* ignore corrupt prefs */
    }
    setAnchorReady(true);
  }, []);

  const WINDOW_PADDING = 12;
  useEffect(() => {
    if (!anchorReady) return;
    const w = currentWidth + WINDOW_PADDING * 2;
    const h = currentHeight + WINDOW_PADDING * 2;
    const anchor = anchorRef.current;
    invoke('set_island_frame', {
      width: w,
      height: h,
      centerX: anchor?.x ?? null,
      top: anchor?.top ?? null,
    }).catch((e) => console.warn('[Island] set_island_frame failed:', e));
  }, [currentWidth, currentHeight, anchorReady]);

  // Persist the anchor whenever the OS reports a window move.
  // Programmatic moves from set_island_frame also fire this event, but
  // they land on exactly the saved anchor, so the save is a no-op.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onMoved(async ({ payload: { x, y } }) => {
          try {
            const scale = await win.scaleFactor();
            const size = await win.outerSize();
            const cx = (x + size.width / 2) / scale;
            const top = y / scale;
            anchorRef.current = { x: cx, top };
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
              try {
                localStorage.setItem(PREF_KEY, JSON.stringify({ x: cx, top }));
              } catch {
                /* ignore quota errors */
              }
            }, 200);
          } catch (e) {
            console.warn('[Island] onMoved handler failed:', e);
          }
        });
      } catch (e) {
        console.warn('[Island] onMoved subscribe failed:', e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, []);

  // Hover hysteresis. Resizing the native NSWindow while the cursor
  // sits on the pill makes AppKit fire transient mouseExited events
  // even though the cursor never physically moves — without this
  // grace period the pill would oscillate (collapse → resize →
  // mouseEnter → expand → resize → mouseExit → loop). 150 ms is long
  // enough to absorb the AppKit jitter and short enough to feel
  // responsive when the user actually moves their cursor off the pill.
  const hoverLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleMouseEnter = () => {
    if (hoverLeaveTimer.current) {
      clearTimeout(hoverLeaveTimer.current);
      hoverLeaveTimer.current = null;
    }
    if (appState !== 'recording') setIsHovered(true);
  };
  const handleMouseLeave = () => {
    if (hoverLeaveTimer.current) clearTimeout(hoverLeaveTimer.current);
    hoverLeaveTimer.current = setTimeout(() => {
      setIsHovered(false);
      hoverLeaveTimer.current = null;
    }, 150);
  };
  useEffect(() => {
    return () => {
      if (hoverLeaveTimer.current) clearTimeout(hoverLeaveTimer.current);
    };
  }, []);

  return (
    <div
      className="flex justify-center items-center w-screen h-screen select-none"
      style={{
        WebkitAppRegion: 'no-drag',
        pointerEvents: 'none',
      } as React.CSSProperties}
    >
      <motion.div
        className="glass rounded-[22px] cursor-grab active:cursor-grabbing relative overflow-hidden"
        animate={{
          width: currentWidth,
          height: currentHeight,
        }}
        transition={islandSpring}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={async (e) => {
          // Left button only; skip interactive children so buttons in
          // the hover menu still click normally.
          if (e.button !== 0) return;
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, [role="button"]')) return;

          // Pointer capture keeps mousemove/mouseup flowing to us even
          // when the cursor leaves the window during a fast drag.
          const node = e.currentTarget as HTMLElement;
          node.setPointerCapture(e.pointerId);

          const win = getCurrentWindow();
          let startPhys: { x: number; y: number };
          let scale: number;
          try {
            const p = await win.outerPosition();
            startPhys = { x: p.x, y: p.y };
            scale = await win.scaleFactor();
          } catch (err) {
            console.warn('[Island] drag init failed:', err);
            return;
          }
          const startX = e.screenX;
          const startY = e.screenY;
          let rafPending = false;
          let latest = { x: startPhys.x, y: startPhys.y };
          let moved = false;

          const onMove = (mv: PointerEvent) => {
            if (mv.pointerId !== e.pointerId) return;
            const dx = (mv.screenX - startX) * scale;
            const dy = (mv.screenY - startY) * scale;
            latest = {
              x: Math.round(startPhys.x + dx),
              y: Math.round(startPhys.y + dy),
            };
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
            if (!rafPending) {
              rafPending = true;
              requestAnimationFrame(() => {
                rafPending = false;
                win
                  .setPosition(new PhysicalPosition(latest.x, latest.y))
                  .catch(() => {});
              });
            }
          };
          const finish = (up: PointerEvent) => {
            if (up.pointerId !== e.pointerId) return;
            try { node.releasePointerCapture(e.pointerId); } catch {}
            node.removeEventListener('pointermove', onMove);
            node.removeEventListener('pointerup', finish);
            node.removeEventListener('pointercancel', finish);
            // If the user genuinely moved the pill, suppress the click
            // event that would otherwise fire on whatever child the
            // mouseup landed on (e.g. an accidental button press).
            if (moved) {
              const swallow = (ce: MouseEvent) => {
                ce.stopPropagation();
                ce.preventDefault();
                node.removeEventListener('click', swallow, true);
              };
              node.addEventListener('click', swallow, true);
              setTimeout(() => node.removeEventListener('click', swallow, true), 0);
            }
          };
          node.addEventListener('pointermove', onMove);
          node.addEventListener('pointerup', finish);
          node.addEventListener('pointercancel', finish);
        }}
        style={{
          pointerEvents: 'auto',
        }}
      >
        {/* Connection indicator dot — vertically centred on the compact
            idle pill, tucked into the corner on every larger state. */}
        <div
          className={`absolute w-1.5 h-1.5 rounded-full transition-colors duration-300 z-10 ${
            visualState === 'idle' ? 'top-1/2 -translate-y-1/2 right-2.5' : 'top-2 right-2'
          } ${
            connectionStatus === 'connected'
              ? 'bg-green-500'
              : connectionStatus === 'connecting'
              ? 'bg-yellow-500 animate-pulse'
              : 'bg-red-500'
          }`}
        />

        {/* State content */}
        <AnimatePresence mode="wait">
          {hoverActive ? (
            <motion.div
              key="hover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full h-full"
            >
              <IslandHover />
            </motion.div>
          ) : showSuccess ? (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full h-full"
            >
              <IslandSuccess text={lastTranscript} />
            </motion.div>
          ) : appState === 'recording' ? (
            <motion.div
              key="recording"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full h-full"
            >
              <IslandRecording />
            </motion.div>
          ) : appState === 'transcribing' ? (
            <motion.div
              key="transcribing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full h-full"
            >
              <IslandTranscribing />
            </motion.div>
          ) : showNoModel ? (
            <motion.div
              key="noModel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full h-full"
            >
              <IslandNoModel />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full h-full"
            >
              <IslandIdle />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
