/**
 * X-Whisper — Transcript History Section (v1.1)
 *
 * Shows the 50 most recent transcriptions, newest first. Row actions:
 *   • Copy text to clipboard
 *   • Paste again — reuses the Tauri `paste_text` command that auto-paste
 *     uses, so the text lands in whichever app was last focused.
 *   • Delete — removes from disk via `delete_transcript`.
 * Header: Clear all + a Save transcripts toggle that also purges the file
 * when switched off.
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Copy, ClipboardPaste, Trash2, Archive } from 'lucide-react';
import { useAppStore, TranscriptHistoryEntry } from '../../../store/useAppStore';
import { useWebSocket } from '../../../store/useWebSocket';

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    if (diff < 0 || Number.isNaN(diff)) return '';
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

export function HistorySection() {
  const entries = useAppStore((s) => s.transcriptHistory);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { sendCommand } = useWebSocket();
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch history on mount. The engine also broadcasts appends / deletes /
  // clears, so the store stays fresh after the initial load.
  useEffect(() => {
    sendCommand('get_transcript_history', {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSaveHistory = () => {
    const next = !settings.saveHistory;
    updateSettings({ saveHistory: next });
    sendCommand('update_setting', { key: 'save_history', value: next });
  };

  const handleCopy = async (entry: TranscriptHistoryEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1500);
    } catch (e) {
      console.error('[History] Copy failed', e);
    }
  };

  const handlePasteAgain = async (entry: TranscriptHistoryEntry) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('paste_text', { text: entry.text });
    } catch (e) {
      // Browser mode fallback: copy only
      try {
        await navigator.clipboard.writeText(entry.text);
      } catch {
        console.error('[History] Paste + clipboard both failed', e);
      }
    }
  };

  const handleDelete = (entry: TranscriptHistoryEntry) => {
    sendCommand('delete_transcript', { id: entry.id });
  };

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    sendCommand('clear_transcript_history', {});
    setConfirmClear(false);
  };

  const isEmpty = useMemo(() => entries.length === 0, [entries]);

  return (
    <div className="space-y-3">
      <div className="settings-card">
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <Archive size={14} className="text-white/40" />
            <div>
              <p className="text-sm text-white/70">Save transcripts</p>
              <p className="text-[10px] text-white/35">
                Keep the last 50 transcriptions locally. Turning off deletes stored history.
              </p>
            </div>
          </div>
          <button
            onClick={toggleSaveHistory}
            className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
              settings.saveHistory ? 'bg-blue-500' : 'bg-white/[0.1]'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                settings.saveHistory ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="settings-card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History size={16} className="text-green-400" />
            <h2 className="text-sm font-semibold text-white/80">Recent transcripts</h2>
            <span className="text-[10px] text-white/35">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
          {!isEmpty && (
            <button
              onClick={handleClearAll}
              className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                confirmClear
                  ? 'border-red-500/40 text-red-400 bg-red-500/10'
                  : 'border-white/[0.08] text-white/50 hover:bg-white/[0.06] hover:text-white/80'
              }`}
            >
              {confirmClear ? 'Click again to confirm' : 'Clear all'}
            </button>
          )}
        </div>

        {isEmpty ? (
          <div className="py-8 text-center">
            <p className="text-[12px] text-white/40">
              {settings.saveHistory
                ? 'No transcripts yet. Press your hotkey and speak — they\'ll appear here.'
                : 'History is turned off. Enable it above to start saving transcripts.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="group rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2 hover:bg-white/[0.05] transition-colors"
              >
                <p className="text-[12px] text-white/80 leading-relaxed whitespace-pre-wrap break-words">
                  {entry.text}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <div className="flex items-center gap-2 text-[10px] text-white/35">
                    <span>{formatRelative(entry.created_at)}</span>
                    {entry.language && <span className="uppercase">{entry.language}</span>}
                    {entry.duration ? <span>{entry.duration.toFixed(1)}s</span> : null}
                  </div>
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleCopy(entry)}
                      title="Copy"
                      className="p-1 rounded hover:bg-white/[0.08] text-white/50 hover:text-white/90 transition-colors"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={() => handlePasteAgain(entry)}
                      title="Paste into last app"
                      className="p-1 rounded hover:bg-white/[0.08] text-white/50 hover:text-white/90 transition-colors"
                    >
                      <ClipboardPaste size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(entry)}
                      title="Delete"
                      className="p-1 rounded hover:bg-red-500/15 text-white/50 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                    {copiedId === entry.id && (
                      <span className="text-[10px] text-green-400 ml-1">Copied</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
