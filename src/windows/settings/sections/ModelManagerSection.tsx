/**
 * X-Whisper — Model Manager Settings Section
 * Shows list of available models with download/load/delete actions.
 */

import { useEffect } from 'react';
import { Download, Trash2, CheckCircle2, HardDrive, Zap, Loader2 } from 'lucide-react';
import { useAppStore, ModelListItem } from '../../../store/useAppStore';
import { useWebSocket } from '../../../store/useWebSocket';
import { PresetsCard } from './PresetsCard';

export function ModelManagerSection() {
  const modelList = useAppStore((s) => s.modelList);
  const currentModel = useAppStore((s) => s.currentModel);
  const modelReady = useAppStore((s) => s.modelReady);
  const downloadingModel = useAppStore((s) => s.downloadingModel);
  const downloadProgress = useAppStore((s) => s.downloadProgress);
  const loadingModel = useAppStore((s) => s.loadingModel);
  const systemInfo = useAppStore((s) => s.systemInfo);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { sendCommand, isConnected } = useWebSocket();

  // Fetch model list on mount
  useEffect(() => {
    if (isConnected) {
      sendCommand('list_models');
      sendCommand('get_presets');
    }
  }, [isConnected, sendCommand]);

  // Manual load/download flips the active preset to 'custom' on the backend,
  // so mirror that locally for instant UI feedback without a round-trip.
  const flipToCustom = (model: string) => {
    updateSettings({ preset: 'custom' });
    sendCommand('update_setting', { key: 'preset', value: 'custom' });
    sendCommand('update_setting', { key: 'model', value: model });
  };

  const handleDownload = (model: string) => {
    sendCommand('download_model', { model });
  };

  const handleLoad = (model: string) => {
    flipToCustom(model);
    sendCommand('load_model', { model });
  };

  const handleUnload = () => {
    sendCommand('unload_model');
  };

  const handleDelete = (model: string) => {
    if (currentModel === model) {
      sendCommand('unload_model');
    }
    sendCommand('delete_model', { model });
  };

  const handleCancelDownload = () => {
    sendCommand('cancel_download');
  };

  const recommendedModel = systemInfo?.recommended_model?.model;

  return (
    <div className="space-y-3">
      <PresetsCard />

      <div className="settings-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-white/80">Model Manager</h2>
        </div>
        {!isConnected && (
          <span className="text-[10px] text-red-400">Engine offline</span>
        )}
      </div>

      {modelList.length === 0 ? (
        <div className="text-sm text-white/30 text-center py-6">
          {isConnected ? 'Loading models...' : 'Connect to engine to manage models'}
        </div>
      ) : (
        <div className="space-y-2">
          {modelList.map((model) => {
            const isActive = modelReady && currentModel === model.name;
            return (
            <ModelRow
              key={model.name}
              model={model}
              isCurrentModel={currentModel === model.name}
              isModelReady={isActive}
              // Only show "loading" while the engine is working on this
              // row AND it isn't already the active model — prevents the
              // pill from lingering if a model_ready event got dropped.
              isLoading={loadingModel === model.name && !isActive}
              isDownloading={downloadingModel === model.name}
              downloadProgress={downloadingModel === model.name ? downloadProgress : 0}
              isRecommended={recommendedModel === model.name}
              onDownload={handleDownload}
              onLoad={handleLoad}
              onUnload={handleUnload}
              onDelete={handleDelete}
              onCancelDownload={handleCancelDownload}
            />
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

// ── Model Row Component ──────────────────────────────────────

interface ModelRowProps {
  model: ModelListItem;
  isCurrentModel: boolean;
  isModelReady: boolean;
  isLoading: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  isRecommended: boolean;
  onDownload: (name: string) => void;
  onLoad: (name: string) => void;
  onUnload: () => void;
  onDelete: (name: string) => void;
  onCancelDownload: () => void;
}

function ModelRow({
  model,
  isCurrentModel,
  isModelReady,
  isLoading,
  isDownloading,
  downloadProgress,
  isRecommended,
  onDownload,
  onLoad,
  onUnload,
  onDelete,
  onCancelDownload,
}: ModelRowProps) {
  return (
    <div className={`rounded-lg border p-3 transition-all duration-300 ${
      isLoading
        ? 'border-amber-500/30 bg-amber-500/[0.03]'
        : isCurrentModel
        ? 'border-blue-500/30 bg-blue-500/[0.05]'
        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
    }`}>
      <div className="flex items-center justify-between">
        {/* Model info */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-white/90">{model.display || model.name}</span>
              {model.requires_network && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  cloud
                </span>
              )}
              {isRecommended && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-0.5">
                  <Zap size={8} />
                  recommended
                </span>
              )}
              {isLoading && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-0.5 animate-pulse">
                  <Loader2 size={8} className="animate-spin" />
                  loading...
                </span>
              )}
              {isModelReady && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-0.5">
                  <CheckCircle2 size={8} />
                  active
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <MetricBar label="Speed" value={model.speed} color="from-cyan-400 to-blue-500" />
              <MetricBar label="Accuracy" value={model.accuracy} color="from-emerald-400 to-green-500" />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
          {isDownloading ? (
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(downloadProgress, 2)}%` }}
                />
              </div>
              <span className="text-[10px] text-white/50 tabular-nums w-10 text-right font-mono">{Math.round(downloadProgress)}%</span>
              <button
                onClick={onCancelDownload}
                className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-amber-400" />
              <span className="text-[10px] text-amber-400/70">Loading...</span>
            </div>
          ) : model.downloaded ? (
            <>
              {isCurrentModel ? (
                <button
                  onClick={onUnload}
                  className="text-[10px] px-2.5 py-1 rounded-md bg-white/[0.06] text-white/50 hover:bg-white/[0.1] hover:text-white/80 transition-colors"
                >
                  Unload
                </button>
              ) : (
                <button
                  onClick={() => onLoad(model.name)}
                  className="text-[10px] px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  Load
                </button>
              )}
              <button
                onClick={() => onDelete(model.name)}
                className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/10 text-white/30 hover:text-red-400 transition-colors"
                title="Delete model"
              >
                <Trash2 size={12} />
              </button>
            </>
          ) : (
            <button
              onClick={() => onDownload(model.name)}
              className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              <Download size={10} />
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Metric Bar ──────────────────────────────────────────────────

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <span className="text-[10px] text-white/40 w-14 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[9px] text-white/35 tabular-nums w-7 text-right font-mono">{percent}%</span>
    </div>
  );
}
