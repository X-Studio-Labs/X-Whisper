/**
 * X-Whisper — File Drop Zone
 *
 * Entry point when no job is running. Accepts browse-click or a native
 * Tauri drag-drop (falls back to a silent no-op in a plain browser).
 */

import { useEffect, useState } from 'react';
import { Upload, FileCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../store/useWebSocket';

const SUPPORTED_EXT = [
  'mp3', 'wav', 'm4a', 'mp4', 'mov', 'ogg', 'oga',
  'flac', 'webm', 'mkv', 'aac', 'wma', 'opus', 'avi',
];

interface DropZoneProps {
  modelReady: boolean;
}

export function DropZone({ modelReady }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [wantSrt, setWantSrt] = useState(false);
  const setFileJobError = useAppStore((s) => s.setFileJobError);
  const { sendCommand } = useWebSocket();

  // Tauri drag-drop — the webview delivers the dropped paths via an
  // event listener. In a browser this just never fires.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const wv = getCurrentWebview();
        const dispose = await wv.onDragDropEvent((event) => {
          if (event.payload.type === 'over' || event.payload.type === 'enter') {
            setDragOver(true);
          } else if (event.payload.type === 'leave') {
            setDragOver(false);
          } else if (event.payload.type === 'drop') {
            setDragOver(false);
            const paths = event.payload.paths ?? [];
            if (paths.length > 0) {
              handlePath(paths[0]);
            }
          }
        });
        unlisten = dispose;
      } catch {
        // Browser mode — drag-drop via Tauri API not available.
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantSrt, modelReady]);

  const handlePath = (path: string) => {
    const lower = path.toLowerCase();
    const ext = lower.includes('.') ? lower.split('.').pop() ?? '' : '';
    if (!SUPPORTED_EXT.includes(ext)) {
      setFileJobError({
        code: 'unsupported_format',
        message: `${ext ? `.${ext}` : 'This format'} is not supported. Try mp3, wav, m4a, mp4, or similar.`,
        filename: path.split(/[\\/]/).pop() ?? path,
      });
      return;
    }
    if (!modelReady) {
      setFileJobError({
        code: 'no_model',
        message: 'Load a model from Settings before transcribing a file.',
      });
      return;
    }
    sendCommand('transcribe_file', { path, want_srt: wantSrt });
  };

  const handleBrowse = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: 'Audio / Video', extensions: SUPPORTED_EXT },
        ],
      });
      if (typeof selected === 'string') handlePath(selected);
    } catch (e) {
      console.error('[Transcribe] Open dialog failed', e);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <button
        type="button"
        onClick={handleBrowse}
        disabled={!modelReady}
        className={`w-full max-w-xl rounded-xl border-2 border-dashed px-6 py-14 transition-colors flex flex-col items-center gap-3 ${
          dragOver
            ? 'border-blue-400/70 bg-blue-500/10'
            : 'border-white/[0.1] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.2]'
        } ${!modelReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className="w-14 h-14 rounded-full bg-white/[0.06] flex items-center justify-center">
          <Upload size={26} className="text-white/70" />
        </div>
        <div className="text-center">
          <p className="text-sm text-white/80">
            {dragOver ? 'Drop to start transcribing' : 'Drop an audio or video file here'}
          </p>
          <p className="text-[11px] text-white/40 mt-1">
            or <span className="text-blue-400">click to browse</span>
          </p>
        </div>
        <p className="text-[10px] text-white/30">
          Supports mp3, wav, m4a, mp4, mov, flac, ogg, webm, and more
        </p>
      </button>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setWantSrt((v) => !v)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-colors ${
            wantSrt
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
              : 'border-white/[0.08] bg-white/[0.02] text-white/50 hover:text-white/80 hover:bg-white/[0.05]'
          }`}
        >
          <FileCheck size={13} />
          <span className="text-[11px]">
            Also generate subtitles (.srt)
          </span>
        </button>
      </div>

      {!modelReady && (
        <p className="mt-6 text-[11px] text-amber-400/80">
          Load a model from Settings before transcribing a file.
        </p>
      )}
    </div>
  );
}
