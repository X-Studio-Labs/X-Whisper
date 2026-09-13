/**
 * X-Whisper — Presets Card (Phase 16)
 *
 * Four preset tiles (Instant / Balanced / Accurate / Turbo Cloud) that resolve
 * to a concrete model given the user's hardware and cloud availability. The
 * resolver lives in `python-engine/presets.py`; the backend ships the catalog
 * via the `presets` event and applies a selection via `apply_preset`. Picking
 * a model manually in the list below flips the active preset to `custom`.
 */

import { Zap, Scale, Target, Cloud, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppStore, PresetName, PresetCatalogEntry } from '../../../store/useAppStore';
import { useWebSocket } from '../../../store/useWebSocket';

type PresetMeta = {
  id: Exclude<PresetName, 'custom'>;
  label: string;
  tagline: string;
  icon: LucideIcon;
  accent: string;
};

const PRESET_META: PresetMeta[] = [
  { id: 'instant',     label: 'Instant',     tagline: 'Fastest pick that still transcribes',       icon: Zap,       accent: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  { id: 'balanced',    label: 'Balanced',    tagline: 'Best quality that fits your hardware',      icon: Scale,     accent: 'text-blue-300 bg-blue-500/10 border-blue-500/25' },
  { id: 'accurate',    label: 'Accurate',    tagline: 'Highest accuracy — heavier, slower',        icon: Target,    accent: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
  { id: 'turbo_cloud', label: 'Turbo Cloud', tagline: 'Cloud-powered, lowest end-to-end latency',    icon: Cloud,     accent: 'text-sky-300 bg-sky-500/10 border-sky-500/25' },
];

function tierLabel(tier: string | undefined): string {
  switch (tier) {
    case 'low':   return 'Low tier';
    case 'mid':   return 'Mid tier';
    case 'high':  return 'High tier';
    case 'beast': return 'Beast tier';
    default:      return 'Unknown tier';
  }
}

export function PresetsCard() {
  const catalog = useAppStore((s) => s.presetCatalog);
  const hardwareProfile = useAppStore((s) => s.hardwareProfile);
  const currentPreset = useAppStore((s) => s.settings.preset);
  const applyingPreset = useAppStore((s) => s.applyingPreset);
  const setApplyingPreset = useAppStore((s) => s.setApplyingPreset);
  const { sendCommand } = useWebSocket();

  const byId: Record<string, PresetCatalogEntry> = Object.fromEntries(
    catalog.map((entry) => [entry.preset, entry]),
  );

  const onPick = (preset: Exclude<PresetName, 'custom'>) => {
    const entry = byId[preset];
    if (entry && !entry.available) return;
    setApplyingPreset(preset);
    sendCommand('apply_preset', { preset });
  };

  const hardwareLine = hardwareProfile
    ? `${hardwareProfile.ram_gb} GB RAM · ${hardwareProfile.has_gpu ? `${hardwareProfile.gpu_name ?? 'GPU'}${hardwareProfile.vram_gb ? ` (${hardwareProfile.vram_gb} GB VRAM)` : ''}` : 'CPU only'} · ${tierLabel(hardwareProfile.tier)}`
    : 'Detecting hardware…';

  return (
    <div className="settings-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-400" />
          <h2 className="text-sm font-semibold text-white/80">Presets</h2>
        </div>
        {currentPreset === 'custom' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/55 border border-white/[0.08]">
            custom
          </span>
        )}
      </div>

      <p className="text-[11px] text-white/40 mb-3 leading-relaxed">
        {hardwareLine}. Pick a preset and X-Whisper loads the best fitting model. Selecting a specific model below switches you to <span className="text-white/60">custom</span>.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {PRESET_META.map((meta) => {
          const entry = byId[meta.id];
          const isActive = currentPreset === meta.id;
          const isApplying = applyingPreset === meta.id;
          const disabled = !entry || !entry.available;
          const Icon = meta.icon;

          return (
            <button
              key={meta.id}
              onClick={() => onPick(meta.id)}
              disabled={disabled || isApplying}
              className={`text-left rounded-lg border p-3 transition-all ${
                isActive
                  ? `${meta.accent} border-current/40`
                  : disabled
                  ? 'bg-white/[0.02] text-white/25 border-white/[0.04] cursor-not-allowed'
                  : 'bg-white/[0.02] text-white/70 border-white/[0.06] hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={13} className={isActive ? '' : 'text-white/50'} />
                <span className="text-[13px] font-semibold">{meta.label}</span>
                {isApplying && (
                  <span className="ml-auto text-[9px] text-white/50 animate-pulse">applying…</span>
                )}
                {isActive && !isApplying && (
                  <span className="ml-auto text-[9px] font-medium uppercase tracking-wider opacity-80">active</span>
                )}
              </div>
              <p className="text-[10px] text-white/45 leading-snug mb-2">{meta.tagline}</p>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="text-white/80 font-medium">
                  {entry?.display ?? '—'}
                </span>
                {entry?.requires_network && (
                  <span className="px-1 py-0.5 rounded bg-sky-500/10 text-sky-300 text-[9px] border border-sky-500/20">
                    cloud
                  </span>
                )}
                {!entry?.available && entry && (
                  <span className="px-1 py-0.5 rounded bg-white/[0.06] text-white/40 text-[9px] border border-white/[0.08]">
                    unavailable
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
