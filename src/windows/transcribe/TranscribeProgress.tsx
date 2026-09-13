/**
 * X-Whisper — Transcribe Progress
 *
 * Active-job view. Shows filename + % progress + elapsed time, plus
 * a Cancel button that asks the engine to abort the running job.
 */

import { useEffect, useState } from 'react';
import { Loader2, X, FileAudio } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../store/useWebSocket';

function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

export function TranscribeProgress() {
  const job = useAppStore((s) => s.fileJob);
  const { sendCommand } = useWebSocket();
  const [now, setNow] = useState(Date.now());
  const [cancelSent, setCancelSent] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  if (!job) return null;

  const elapsed = now - job.startedAt;
  const percent = Math.max(0, Math.min(100, job.percent));
  const isPreparing = percent < 1;

  const handleCancel = () => {
    if (cancelSent) return;
    setCancelSent(true);
    sendCommand('cancel_file_transcribe', { job_id: job.id });
  };

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="w-full max-w-xl rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-white/[0.05] flex items-center justify-center">
            <FileAudio size={18} className="text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-white/90 truncate">{job.filename}</p>
            <p className="text-[10px] text-white/40 mt-0.5">
              {job.provider ?? '—'}
              {job.model ? ` · ${job.model}` : ''}
              {job.wantSrt ? ' · subtitles' : ''}
            </p>
          </div>
          <button
            onClick={handleCancel}
            disabled={cancelSent}
            className="p-1.5 rounded hover:bg-white/[0.08] text-white/50 hover:text-red-400 transition-colors disabled:opacity-50"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-[11px] text-white/50 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin text-blue-400" />
              {cancelSent
                ? 'Cancelling…'
                : isPreparing
                ? 'Preparing audio…'
                : 'Transcribing…'}
            </span>
            <span>{Math.round(percent)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isPreparing
                  ? 'bg-white/30 animate-pulse w-[15%]'
                  : 'bg-blue-500'
              }`}
              style={isPreparing ? undefined : { width: `${percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-white/35 mt-2">
            <span>Elapsed {formatElapsed(elapsed)}</span>
            <span>Keeps running in the background — safe to minimise.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
