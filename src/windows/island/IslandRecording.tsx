/**
 * X-Whisper — Island Recording State
 * Shows recording indicator, waveform, and timer.
 */

import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { Waveform } from './Waveform';
import { wsManager } from '../../store/useWebSocket';

export function IslandRecording() {
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);

  const handleStop = () => {
    if (stopping) return;
    setStopping(true);
    wsManager.send({ cmd: 'stop_recording' });
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full px-4 justify-center">
      <div className="flex items-center gap-3">
        {/* Recording dot */}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#FF3B30] animate-pulse-recording" />
          <span className="text-xs font-semibold text-[#FF3B30] uppercase tracking-wide">
            REC
          </span>
        </div>

        {/* Waveform */}
        <div className="flex-1 max-w-[200px]">
          <Waveform />
        </div>

        {/* Timer */}
        <span className="text-xs font-mono text-white/60 tabular-nums">
          {formatTime(elapsed)}
        </span>

        {/* Stop button */}
        <button
          type="button"
          onClick={handleStop}
          disabled={stopping}
          className="w-6 h-6 flex items-center justify-center rounded-md bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Stop recording"
        >
          <Square size={10} className="text-white/80" />
        </button>
      </div>
    </div>
  );
}
