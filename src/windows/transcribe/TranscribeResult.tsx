/**
 * X-Whisper — Transcribe Result
 *
 * Completed-job view. Shows the transcript text + export actions
 * (copy, save .txt, save .srt if available, save to history).
 */

import { useState } from 'react';
import {
  Copy, Check, Download, FileCheck, Save, RefreshCcw, FileAudio,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../store/useWebSocket';

function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function TranscribeResult() {
  const result = useAppStore((s) => s.fileResult);
  const setFileResult = useAppStore((s) => s.setFileResult);
  const { sendCommand } = useWebSocket();

  const [copied, setCopied] = useState(false);
  const [savingTxt, setSavingTxt] = useState(false);
  const [savingSrt, setSavingSrt] = useState(false);

  if (!result) return null;

  const charCount = result.text.length;
  const wordCount = result.text.trim() ? result.text.trim().split(/\s+/).length : 0;
  const stem = baseName(result.filename);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('[Transcribe] Copy failed', e);
    }
  };

  const saveToDisk = async (defaultName: string, contents: string) => {
    try {
      const [{ save }, { invoke }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/api/core'),
      ]);
      const target = await save({
        defaultPath: defaultName,
        filters: defaultName.endsWith('.srt')
          ? [{ name: 'SubRip Subtitle', extensions: ['srt'] }]
          : [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!target) return;
      await invoke('save_text_file', { path: target, contents });
    } catch (e) {
      console.error('[Transcribe] Save failed', e);
    }
  };

  const handleSaveTxt = async () => {
    setSavingTxt(true);
    try {
      await saveToDisk(`${stem}.txt`, result.text);
    } finally {
      setSavingTxt(false);
    }
  };

  const handleSaveSrt = async () => {
    if (!result.srt) return;
    setSavingSrt(true);
    try {
      await saveToDisk(`${stem}.srt`, result.srt);
    } finally {
      setSavingSrt(false);
    }
  };

  const handleSaveHistory = () => {
    sendCommand('save_file_transcript', {
      text: result.text,
      language: result.language,
      duration: result.duration,
      model: result.model,
      provider: result.provider,
    });
  };

  const handleAnother = () => setFileResult(null);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-md bg-green-500/15 flex items-center justify-center">
            <FileAudio size={18} className="text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-white/90 truncate">
              {result.filename}
            </p>
            <p className="text-[10px] text-white/40 mt-0.5">
              {result.language?.toUpperCase() ?? 'Auto'} ·{' '}
              {result.duration ? `${result.duration.toFixed(1)}s · ` : ''}
              {wordCount} words · {charCount} chars
              {result.provider ? ` · ${result.provider}` : ''}
              {result.model ? ` / ${result.model}` : ''}
            </p>
          </div>
          <button
            onClick={handleAnother}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[11px] text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-colors"
          >
            <RefreshCcw size={11} />
            Transcribe another
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[11px] text-white/70 hover:bg-white/[0.06] hover:text-white/90 transition-colors"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy text'}
          </button>
          <button
            onClick={handleSaveTxt}
            disabled={savingTxt}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[11px] text-white/70 hover:bg-white/[0.06] hover:text-white/90 transition-colors disabled:opacity-60"
          >
            <Download size={12} />
            Save .txt
          </button>
          {result.srt && (
            <button
              onClick={handleSaveSrt}
              disabled={savingSrt}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[11px] text-white/70 hover:bg-white/[0.06] hover:text-white/90 transition-colors disabled:opacity-60"
            >
              <FileCheck size={12} />
              Save .srt
            </button>
          )}
          <button
            onClick={handleSaveHistory}
            disabled={result.savedToHistory}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[11px] transition-colors ${
              result.savedToHistory
                ? 'border-green-500/30 bg-green-500/10 text-green-300 cursor-default'
                : 'border-white/[0.08] bg-white/[0.03] text-white/70 hover:bg-white/[0.06] hover:text-white/90'
            }`}
          >
            {result.savedToHistory ? <Check size={12} /> : <Save size={12} />}
            {result.savedToHistory ? 'Saved to history' : 'Save to history'}
          </button>
        </div>

        <div className="mt-4">
          <p className="text-[10px] text-white/35 uppercase tracking-wide mb-1.5">
            Transcript
          </p>
          <textarea
            readOnly
            value={result.text}
            className="w-full min-h-[280px] max-h-[480px] resize-y rounded-md border border-white/[0.06] bg-black/30 px-3 py-2 text-[12px] text-white/85 leading-relaxed focus:border-blue-500/40 focus:outline-none font-mono"
          />
        </div>
      </div>
    </div>
  );
}
