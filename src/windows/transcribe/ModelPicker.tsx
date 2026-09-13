/**
 * X-Whisper — Transcribe File Model Picker
 *
 * Compact popover in the Transcribe window header. Lets the user
 * switch, download, or cancel-download a model without leaving the
 * file-transcribe flow. Kicking off a download auto-loads the model
 * once the engine signals completion.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CheckCircle2, Loader2, Cloud, Download, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../store/useWebSocket';

async function openSettings() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_settings');
  } catch (e) {
    console.debug('[Transcribe] Settings window not available (browser mode)', e);
  }
}

export function ModelPicker() {
  const modelList = useAppStore((s) => s.modelList);
  const currentModel = useAppStore((s) => s.currentModel);
  const modelReady = useAppStore((s) => s.modelReady);
  const loadingModel = useAppStore((s) => s.loadingModel);
  const downloadingModel = useAppStore((s) => s.downloadingModel);
  const downloadProgress = useAppStore((s) => s.downloadProgress);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const fileJob = useAppStore((s) => s.fileJob);
  const { sendCommand, isConnected } = useWebSocket();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Remember the model the user picked-to-download so we can auto-load it
  // when the refreshed model_list flips it to downloaded=true.
  const pendingLoadRef = useRef<string | null>(null);

  useEffect(() => {
    if (isConnected && modelList.length === 0) {
      sendCommand('list_models');
    }
  }, [isConnected, modelList.length, sendCommand]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const activeEntry = modelList.find((m) => m.name === currentModel);
  const isBusy = !!loadingModel || !!downloadingModel;
  const canSwitch = !fileJob;

  // When a download finishes the WS layer refreshes the model list. If the
  // user kicked off that download from here, auto-load it so the next
  // action they take is transcribing, not another click.
  useEffect(() => {
    if (!pendingLoadRef.current) return;
    const entry = modelList.find((m) => m.name === pendingLoadRef.current);
    if (entry?.downloaded) {
      const name = pendingLoadRef.current;
      pendingLoadRef.current = null;
      updateSettings({ preset: 'custom' });
      sendCommand('update_setting', { key: 'preset', value: 'custom' });
      sendCommand('update_setting', { key: 'model', value: name });
      sendCommand('load_model', { model: name });
    }
  }, [modelList, sendCommand, updateSettings]);

  const handleLoad = (name: string) => {
    updateSettings({ preset: 'custom' });
    sendCommand('update_setting', { key: 'preset', value: 'custom' });
    sendCommand('update_setting', { key: 'model', value: name });
    sendCommand('load_model', { model: name });
  };

  const handleDownload = (name: string) => {
    pendingLoadRef.current = name;
    sendCommand('download_model', { model: name });
  };

  const handleCancelDownload = () => {
    pendingLoadRef.current = null;
    sendCommand('cancel_download');
  };

  const handlePick = (name: string, downloaded: boolean) => {
    if (downloadingModel) return;
    if (name === currentModel && modelReady) {
      setOpen(false);
      return;
    }
    if (downloaded) {
      handleLoad(name);
    } else {
      handleDownload(name);
    }
    // Keep popover open if we're downloading so the user sees progress.
    if (downloaded) setOpen(false);
  };

  const label = downloadingModel
    ? `Downloading ${downloadingModel}… ${Math.round(downloadProgress)}%`
    : loadingModel
    ? `Loading ${loadingModel}…`
    : modelReady && currentModel
    ? (activeEntry?.display || currentModel)
    : 'No model loaded';

  return (
    <div className="relative" ref={rootRef}>
      <p className="text-[10px] text-white/35 uppercase tracking-wide text-right">Model</p>
      <button
        type="button"
        disabled={!canSwitch}
        onClick={() => setOpen((v) => !v)}
        className={`mt-0.5 flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-[12px] text-white/80 transition-colors ${
          canSwitch ? 'hover:bg-white/[0.05] hover:border-white/[0.12]' : 'opacity-60 cursor-not-allowed'
        }`}
        title={canSwitch ? 'Switch model' : 'Cancel the current job to switch models'}
      >
        {downloadingModel ? (
          <Loader2 size={11} className="animate-spin text-blue-400" />
        ) : loadingModel ? (
          <Loader2 size={11} className="animate-spin text-amber-400" />
        ) : modelReady ? (
          <CheckCircle2 size={11} className="text-green-400" />
        ) : null}
        <span className="truncate max-w-[180px]">{label}</span>
        <ChevronDown size={11} className="text-white/40" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-64 rounded-lg border border-white/[0.08] bg-[#111] shadow-xl z-20 overflow-hidden">
          <div className="px-3 py-2 text-[10px] text-white/40 uppercase tracking-wide border-b border-white/[0.04]">
            Choose a model
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {modelList.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-white/40">
                {isConnected ? 'Loading models…' : 'Engine offline'}
              </div>
            ) : (
              modelList.map((m) => {
                const isActive = modelReady && currentModel === m.name;
                const isLoading = loadingModel === m.name;
                const isDownloading = downloadingModel === m.name;
                const downloaded = m.downloaded || m.requires_network;
                const rowDisabled = isBusy && !isLoading && !isDownloading;
                return (
                  <div
                    key={m.name}
                    className={`px-3 py-2 text-[12px] transition-colors ${
                      isActive
                        ? 'bg-blue-500/10 text-blue-300'
                        : 'text-white/75 hover:bg-white/[0.05]'
                    } ${rowDisabled ? 'opacity-50' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => !rowDisabled && !isDownloading && handlePick(m.name, downloaded)}
                      disabled={rowDisabled || isDownloading}
                      className={`w-full flex items-center gap-2 text-left ${
                        rowDisabled || isDownloading ? 'cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <span className="flex-1 truncate">{m.display || m.name}</span>
                      {m.requires_network && (
                        <Cloud size={11} className="text-sky-400/80" />
                      )}
                      {isLoading ? (
                        <Loader2 size={11} className="animate-spin text-amber-400" />
                      ) : isDownloading ? (
                        <Loader2 size={11} className="animate-spin text-blue-400" />
                      ) : isActive ? (
                        <CheckCircle2 size={11} className="text-green-400" />
                      ) : !downloaded ? (
                        <Download size={11} className="text-white/30" />
                      ) : null}
                    </button>
                    {isDownloading && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${Math.max(downloadProgress, 2)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-white/50 tabular-nums w-8 text-right font-mono">
                          {Math.round(downloadProgress)}%
                        </span>
                        <button
                          type="button"
                          onClick={handleCancelDownload}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/15 text-white/40 hover:text-red-400 transition-colors"
                          title="Cancel download"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="px-3 py-2 border-t border-white/[0.04]">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openSettings();
              }}
              className="text-[11px] text-white/50 hover:text-white/80 transition-colors"
            >
              Manage models in Settings →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
