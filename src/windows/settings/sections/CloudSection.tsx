/**
 * X-Whisper — Cloud Settings Section
 *
 * Bring-your-own-key: cloud models (Turbo Cloud, Pro Cloud) call Groq's
 * API directly with a key the user pastes here. The engine validates the
 * key before storing it in the OS keyring (`set_groq_key`), so a bad key
 * never gets saved. The offline-only toggle blocks cloud models even when
 * a key is present.
 */

import { useEffect, useState } from 'react';
import { Cloud, CheckCircle2, XCircle, WifiOff, KeyRound, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useWebSocket } from '../../../store/useWebSocket';

const GROQ_CONSOLE_URL = 'https://console.groq.com/keys';

async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

export function CloudSection() {
  const groqKeyStatus = useAppStore((s) => s.groqKeyStatus);
  const groqKeyTestResult = useAppStore((s) => s.groqKeyTestResult);
  const setGroqKeyTestResult = useAppStore((s) => s.setGroqKeyTestResult);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { sendCommand } = useWebSocket();

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const cloudAvailable = groqKeyStatus.hasKey;

  // Any reply (success or failure) ends the in-flight state.
  useEffect(() => {
    if (groqKeyTestResult !== null) {
      setSaving(false);
      if (groqKeyTestResult.ok) setDraft('');
    }
  }, [groqKeyTestResult]);

  const saveKey = () => {
    const key = draft.trim();
    if (!key || saving) return;
    setGroqKeyTestResult(null);
    setSaving(true);
    sendCommand('set_groq_key', { api_key: key });
  };

  const clearKey = () => {
    setGroqKeyTestResult(null);
    sendCommand('clear_groq_key');
  };

  const toggleOffline = () => {
    const next = !settings.offlineOnly;
    updateSettings({ offlineOnly: next });
    sendCommand('update_setting', { key: 'offline_only', value: next });
  };

  return (
    <div className="space-y-3">
      <div className="settings-card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Cloud size={16} className="text-sky-400" />
            <h2 className="text-sm font-semibold text-white/80">Cloud Transcription</h2>
          </div>
          <div className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border ${
            cloudAvailable
              ? 'bg-green-500/10 text-green-400 border-green-500/20'
              : 'bg-white/[0.05] text-white/50 border-white/[0.08]'
          }`}>
            {cloudAvailable
              ? <CheckCircle2 size={10} />
              : <XCircle size={10} />
            }
            {cloudAvailable ? 'Available' : 'Unavailable'}
          </div>
        </div>
        <p className="text-[11px] text-white/40 leading-relaxed">
          Cloud models (Turbo Cloud, Pro Cloud) run on Groq using your own API key. Audio is sent
          to Groq for the transcription and nothing is stored by X-Whisper. Local models never
          need a key.
        </p>
      </div>

      <div className="settings-card">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={16} className="text-white/40" />
          <h2 className="text-sm font-semibold text-white/80">Groq API Key</h2>
        </div>

        {cloudAvailable ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-white/70 font-mono truncate">{groqKeyStatus.masked || '••••••••'}</p>
              <p className="text-[11px] text-white/35 mt-0.5">Stored in your system keyring.</p>
            </div>
            <button
              onClick={clearKey}
              className="h-8 px-3 rounded-md border border-white/10 text-[12px] text-white/60 hover:text-red-300 hover:border-red-500/30 hover:bg-red-500/5 transition-colors flex items-center gap-1.5 shrink-0"
            >
              <Trash2 size={12} />
              Remove
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
                placeholder="gsk_…"
                disabled={saving}
                className="flex-1 min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-mono text-white/80 placeholder:text-white/25 focus:border-blue-500/50 focus:bg-white/[0.06] focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={saveKey}
                disabled={saving || !draft.trim()}
                className="h-9 px-4 rounded-md bg-white text-black text-[12px] font-medium hover:bg-white/90 transition-colors disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}
                {saving ? 'Checking…' : 'Save'}
              </button>
            </div>
            <button
              onClick={() => openExternal(GROQ_CONSOLE_URL)}
              className="self-start text-[11px] text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
            >
              Get a free key from console.groq.com
              <ExternalLink size={10} />
            </button>
          </div>
        )}

        {groqKeyTestResult && !groqKeyTestResult.ok && (
          <p className="mt-2 text-[11px] text-red-400/90">
            {groqKeyTestResult.message || 'That key was rejected by Groq.'}
          </p>
        )}
      </div>

      <div className="settings-card">
        <div className="flex items-center gap-2 mb-3">
          <WifiOff size={16} className="text-white/40" />
          <h2 className="text-sm font-semibold text-white/80">Offline Only</h2>
        </div>
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <p className="text-sm text-white/70">Block cloud models</p>
            <p className="text-[11px] text-white/35 mt-0.5">
              When enabled, cloud models won't be loaded and the app will stay fully local.
            </p>
          </div>
          <button
            onClick={toggleOffline}
            className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${
              settings.offlineOnly ? 'bg-blue-500' : 'bg-white/[0.1]'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                settings.offlineOnly ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
