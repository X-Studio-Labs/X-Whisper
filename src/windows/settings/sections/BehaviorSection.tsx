/**
 * X-Whisper — Behavior Settings Section
 * Auto-paste toggle, beam size, launch at startup.
 */

import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Sliders, Power, BookOpen, Eye, EyeOff, Mic } from 'lucide-react';
import { useAppStore, type IslandVisibility } from '../../../store/useAppStore';
import { useWebSocket } from '../../../store/useWebSocket';

const INITIAL_PROMPT_MAX = 900;

const ISLAND_MODES: { id: IslandVisibility; label: string; hint: string; icon: typeof Eye }[] = [
  { id: 'always', label: 'Always', hint: 'Pill stays on screen', icon: Eye },
  { id: 'speaking', label: 'While speaking', hint: 'Appears when you record, hides after', icon: Mic },
  { id: 'hidden', label: 'Hidden', hint: 'Never shown — hotkey still works', icon: EyeOff },
];

export function BehaviorSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { sendCommand } = useWebSocket();

  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [promptDraft, setPromptDraft] = useState(settings.initialPrompt ?? '');
  const promptDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const enabled = await invoke('get_launch_at_startup');
        setLaunchAtStartup(enabled as boolean);
      } catch {
        // Browser mode or not Windows
      }
    })();
  }, []);

  // Keep local draft in sync when the engine replays persisted settings.
  useEffect(() => {
    setPromptDraft(settings.initialPrompt ?? '');
  }, [settings.initialPrompt]);

  const SNAKE_KEYS: Record<string, string> = {
    autoPaste: 'auto_paste',
    beamSize: 'beam_size',
    initialPrompt: 'initial_prompt',
    launchAtStartup: 'launch_at_startup',
    islandVisibility: 'island_visibility',
  };

  const updateAndPersist = (key: string, value: unknown) => {
    updateSettings({ [key]: value } as any);
    sendCommand('update_setting', { key: SNAKE_KEYS[key] ?? key, value });
  };

  const onPromptChange = (next: string) => {
    const capped = next.length > INITIAL_PROMPT_MAX ? next.slice(0, INITIAL_PROMPT_MAX) : next;
    setPromptDraft(capped);
    updateSettings({ initialPrompt: capped });
    if (promptDebounce.current) clearTimeout(promptDebounce.current);
    promptDebounce.current = setTimeout(() => {
      sendCommand('update_setting', { key: 'initial_prompt', value: capped });
    }, 400);
  };

  const toggleStartup = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const next = !launchAtStartup;
      await invoke('set_launch_at_startup', { enabled: next });
      setLaunchAtStartup(next);
      updateAndPersist('launchAtStartup', next);
    } catch (e) {
      console.debug('[Settings] Launch at startup not available', e);
    }
  };

  return (
    <div className="space-y-3">
      <div className="settings-card">
        <div className="flex items-center gap-2 mb-4">
          <Sliders size={16} className="text-green-400" />
          <h2 className="text-sm font-semibold text-white/80">Behavior</h2>
        </div>

        {/* Auto-paste toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <ClipboardPaste size={14} className="text-white/40" />
            <div>
              <p className="text-sm text-white/70">Auto-paste</p>
              <p className="text-[10px] text-white/35">Automatically paste transcript into active window</p>
            </div>
          </div>
          <button
            onClick={() => updateAndPersist('autoPaste', !settings.autoPaste)}
            className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
              settings.autoPaste ? 'bg-blue-500' : 'bg-white/[0.1]'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                settings.autoPaste ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Dynamic Island visibility */}
        <div className="py-2 mt-1">
          <div className="flex items-center gap-2 mb-2">
            <Eye size={14} className="text-white/40" />
            <div>
              <p className="text-sm text-white/70">Dynamic Island</p>
              <p className="text-[10px] text-white/35">
                {ISLAND_MODES.find((m) => m.id === settings.islandVisibility)?.hint}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {ISLAND_MODES.map(({ id, label, icon: Icon }) => {
              const selected = settings.islandVisibility === id;
              return (
                <button
                  key={id}
                  onClick={() => updateAndPersist('islandVisibility', id)}
                  className={`h-9 rounded-md text-[11px] flex items-center justify-center gap-1.5 transition-colors ${
                    selected
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-white/[0.04] text-white/40 border border-white/[0.06] hover:bg-white/[0.08]'
                  }`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Beam size */}
        <div className="flex items-center justify-between py-2 mt-1">
          <div>
            <p className="text-sm text-white/70">Beam size</p>
            <p className="text-[10px] text-white/35">Higher values = more accurate but slower</p>
          </div>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 5].map((size) => (
              <button
                key={size}
                onClick={() => updateAndPersist('beamSize', size)}
                className={`text-[11px] w-7 h-7 rounded-md transition-colors ${
                  settings.beamSize === size
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'bg-white/[0.04] text-white/40 border border-white/[0.06] hover:bg-white/[0.08]'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={16} className="text-green-400" />
          <h2 className="text-sm font-semibold text-white/80">Custom vocabulary</h2>
        </div>
        <p className="text-[11px] text-white/45 mb-2 leading-relaxed">
          Names or jargon you want spelled correctly — e.g.{' '}
          <span className="text-white/60">"X-Studio Labs, X-Whisper, Tauri, AI"</span>.
        </p>
        <textarea
          value={promptDraft}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Add words you want recognized accurately"
          rows={3}
          maxLength={INITIAL_PROMPT_MAX}
          className="w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] text-white/80 placeholder:text-white/25 focus:border-blue-500/50 focus:bg-white/[0.06] focus:outline-none"
        />
        <div className="flex justify-end mt-1">
          <span className={`text-[10px] ${promptDraft.length >= INITIAL_PROMPT_MAX ? 'text-amber-400/80' : 'text-white/30'}`}>
            {promptDraft.length} / {INITIAL_PROMPT_MAX}
          </span>
        </div>
      </div>

      <div className="settings-card">
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2">
            <Power size={14} className="text-white/40" />
            <div>
              <p className="text-sm text-white/70">Launch at startup</p>
              <p className="text-[10px] text-white/35">Start X-Whisper when you sign into Windows</p>
            </div>
          </div>
          <button
            onClick={toggleStartup}
            className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
              launchAtStartup ? 'bg-blue-500' : 'bg-white/[0.1]'
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                launchAtStartup ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
