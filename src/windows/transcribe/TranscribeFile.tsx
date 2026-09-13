/**
 * X-Whisper — Transcribe File Window (Phase 19)
 *
 * Dedicated window for uploading an audio/video file and getting a
 * transcript back. Three states: idle (DropZone), running
 * (TranscribeProgress), and done (TranscribeResult). Errors overlay
 * idle. The engine handles ffmpeg decoding and whisper-cli invocation.
 */

import React, { useEffect } from 'react';
import { AlertTriangle, FileAudio } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../store/useWebSocket';
import { DropZone } from './DropZone';
import { TranscribeProgress } from './TranscribeProgress';
import { TranscribeResult } from './TranscribeResult';
import { ModelPicker } from './ModelPicker';

export function TranscribeFile() {
  useWebSocket();

  const fileJob = useAppStore((s) => s.fileJob);
  const fileResult = useAppStore((s) => s.fileResult);
  const fileJobError = useAppStore((s) => s.fileJobError);
  const setFileJobError = useAppStore((s) => s.setFileJobError);
  const modelReady = useAppStore((s) => s.modelReady);

  // Clear any leftover error when a new job starts or a result arrives.
  useEffect(() => {
    if (fileJob || fileResult) setFileJobError(null);
  }, [fileJob, fileResult, setFileJobError]);

  return (
    <div className="h-screen flex flex-col bg-[#0A0A0A] text-white overflow-hidden">
      <div
        className="h-8 w-full flex-shrink-0 border-b border-white/[0.03] flex items-center px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 text-[11px] text-white/40">
          <FileAudio size={12} />
          <span>Transcribe File</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="border-b border-white/[0.03] px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white/90">Transcribe a file</h1>
            <p className="text-[11px] text-white/40 mt-0.5">
              Drop in an audio or video file — X-Whisper does the rest.
            </p>
          </div>
          <ModelPicker />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
          {fileJobError && !fileJob && !fileResult && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[12px] font-medium text-red-300">
                  {fileJobError.filename
                    ? `Couldn't transcribe ${fileJobError.filename}`
                    : 'Transcription failed'}
                </p>
                <p className="text-[11px] text-red-300/80 mt-0.5">{fileJobError.message}</p>
              </div>
              <button
                onClick={() => setFileJobError(null)}
                className="text-[11px] text-red-300/60 hover:text-red-300"
              >
                Dismiss
              </button>
            </div>
          )}

          {fileJob ? (
            <TranscribeProgress />
          ) : fileResult ? (
            <TranscribeResult />
          ) : (
            <DropZone modelReady={modelReady} />
          )}
        </div>
      </div>
    </div>
  );
}
