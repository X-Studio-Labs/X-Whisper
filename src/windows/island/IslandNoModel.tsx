/**
 * X-Whisper — Island "No Model" CTA
 *
 * Shown when the hotkey is pressed before any model is ready. The
 * engine auto-triggers the download if nothing is on disk; this pill
 * reassures the user it's happening and tells them to try again
 * shortly.
 */

import { Download, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export function IslandNoModel() {
  const cta = useAppStore((s) => s.noModelCTA);
  const downloadingModel = useAppStore((s) => s.downloadingModel);
  const downloadProgress = useAppStore((s) => s.downloadProgress);
  const modelList = useAppStore((s) => s.modelList);

  if (!cta) return null;

  const entry = modelList.find((m) => m.id === cta.model || m.name === cta.model);
  const label = entry?.display ?? cta.model;

  const isDownloading =
    cta.status === 'downloading' || downloadingModel === cta.model;
  const percent =
    isDownloading && downloadingModel === cta.model ? downloadProgress : 0;

  return (
    <div className="flex flex-col justify-center h-full px-4 gap-1.5">
      <div className="flex items-center gap-2.5">
        {isDownloading ? (
          <Download size={14} className="text-white/70 shrink-0" />
        ) : (
          <Loader2 size={14} className="text-white/70 shrink-0 animate-spin" />
        )}
        <span className="text-xs font-medium text-white/90 truncate">
          {isDownloading ? 'Downloading' : 'Loading'} {label}
        </span>
        {isDownloading && percent > 0 && (
          <span className="text-[10px] text-white/50 tabular-nums ml-auto">
            {Math.round(percent)}%
          </span>
        )}
      </div>
      {isDownloading && (
        <div className="h-[3px] bg-white/[0.08] rounded-full overflow-hidden">
          <div
            className="h-full bg-white/60 transition-[width] duration-500"
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
      )}
      <span className="text-[10px] text-white/50 truncate">
        Press the hotkey again when ready.
      </span>
    </div>
  );
}
