/**
 * X-Whisper — About Section
 * Shows app version, system info, hardware tier, and links.
 */

import { useEffect, useState } from 'react';
import { Info, Cpu, HardDrive, Wifi, WifiOff, RotateCw, Gauge, Globe, Code, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { useWebSocket } from '../../../store/useWebSocket';
import { restartEngine } from '../../../store/useEngineHealth';

const WEBSITE_URL = 'https://x-studio.live';
const GITHUB_URL = 'https://github.com/X-Studio-Labs/X-Whisper';

async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}

const TIER_LABELS: Record<string, string> = {
  low: 'Low',
  mid: 'Mid',
  high: 'High',
  beast: 'Beast',
};

/** App version from the Tauri bundle (tauri.conf.json); falls back to
 *  a placeholder in browser mode. */
function useAppVersion(): string {
  const [version, setVersion] = useState('dev');
  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        setVersion(await getVersion());
      } catch {
        /* browser mode */
      }
    })();
  }, []);
  return version;
}

export function AboutSection() {
  const version = useAppVersion();
  const systemInfo = useAppStore((s) => s.systemInfo);
  const currentModel = useAppStore((s) => s.currentModel);
  const hardwareProfile = useAppStore((s) => s.hardwareProfile);
  const { connectionStatus, sendCommand } = useWebSocket();

  const tier = systemInfo?.hardware_tier ?? hardwareProfile?.tier;
  const vram = systemInfo?.vram_gb ?? hardwareProfile?.vram_gb;

  return (
    <div className="settings-card">
      <div className="flex items-center gap-2 mb-4">
        <Info size={16} className="text-white/40" />
        <h2 className="text-sm font-semibold text-white/80">About</h2>
      </div>

      {/* Engine status */}
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' ? (
            <Wifi size={14} className="text-green-500" />
          ) : (
            <WifiOff size={14} className="text-red-500" />
          )}
          <span className="text-sm text-white/70">Engine</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            connectionStatus === 'connected'
              ? 'bg-green-500/10 text-green-400'
              : connectionStatus === 'connecting'
              ? 'bg-yellow-500/10 text-yellow-400'
              : 'bg-red-500/10 text-red-400'
          }`}>
            {connectionStatus}
          </span>
          <button
            onClick={() => sendCommand('get_system_info')}
            className="text-[10px] px-2 py-0.5 rounded bg-white/[0.05] text-white/40 hover:bg-white/[0.1] hover:text-white/60 transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={async () => {
              const result = await restartEngine();
              console.log('[Settings] Restart engine:', result);
            }}
            className="text-[10px] px-2 py-0.5 rounded bg-white/[0.05] text-white/40 hover:bg-amber-500/20 hover:text-amber-400 transition-colors flex items-center gap-1"
            title="Restart Python engine"
          >
            <RotateCw size={10} />
            Restart
          </button>
        </div>
      </div>

      {/* System info grid */}
      {systemInfo && (
        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-white/[0.04]">
          <InfoItem icon={<HardDrive size={12} />} label="RAM" value={`${systemInfo.available_ram_gb}GB / ${systemInfo.total_ram_gb}GB`} />
          <InfoItem icon={<Cpu size={12} />} label="GPU" value={systemInfo.gpu ? `${systemInfo.gpu}${vram ? ` (${vram}GB)` : ''}` : 'CPU only'} />
          <InfoItem icon={<Gauge size={12} />} label="Hardware Tier" value={tier ? TIER_LABELS[tier] ?? tier : 'Unknown'} />
          <InfoItem label="Active Model" value={currentModel || 'None'} />
        </div>
      )}

      {/* Version */}
      <div className="text-center mt-5 pt-3 border-t border-white/[0.04]">
        <p className="text-sm font-semibold text-white/60">X-Whisper</p>
        <p className="text-[10px] text-white/25 mt-0.5">v{version} · Speech-to-Text · MIT licensed</p>
        <p className="text-[10px] text-white/20 mt-0.5">Built by X-Studio</p>
        <div className="flex items-center justify-center gap-2 mt-3">
          <LinkButton icon={<Globe size={11} />} label="x-studio.live" onClick={() => openExternal(WEBSITE_URL)} />
          <LinkButton icon={<Code size={11} />} label="Source on GitHub" onClick={() => openExternal(GITHUB_URL)} />
        </div>
      </div>
    </div>
  );
}

function LinkButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-7 px-2.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/50 hover:text-white/80 hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
    >
      {icon}
      {label}
      <ExternalLink size={9} className="text-white/30" />
    </button>
  );
}

function InfoItem({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5">
      {icon && <span className="text-white/30 mt-0.5">{icon}</span>}
      <div>
        <p className="text-[10px] text-white/30">{label}</p>
        <p className="text-xs text-white/60 truncate">{value}</p>
      </div>
    </div>
  );
}
