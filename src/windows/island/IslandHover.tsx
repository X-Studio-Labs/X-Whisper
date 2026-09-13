/**
 * X-Whisper — Island Hover Expanded State
 * Shows detailed info when user hovers over the island.
 * Allows opening Settings window via Tauri API.
 */

import { Settings, Cpu, HardDrive, FileAudio } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

async function openSettings() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_settings');
  } catch (e) {
    console.debug('[Island] Settings window not available (browser mode)', e);
  }
}

async function openTranscribeFile() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_transcribe_window');
  } catch (e) {
    console.debug('[Island] Transcribe window not available (browser mode)', e);
  }
}

export function IslandHover() {
  const systemInfo = useAppStore((s) => s.systemInfo);
  const currentModel = useAppStore((s) => s.currentModel);
  const lastTranscript = useAppStore((s) => s.lastTranscript);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const modelReady = useAppStore((s) => s.modelReady);

  return (
    <div className="flex flex-col h-full px-4 py-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded overflow-hidden flex items-center justify-center bg-black/20 shrink-0">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-cover scale-[2.0]" />
          </div>
          <span className="text-sm font-semibold text-white/90">X-Whisper</span>
          {modelReady && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
              ready
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={openTranscribeFile}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors"
            title="Transcribe a file"
          >
            <FileAudio size={12} className="text-white/50 hover:text-white/80 transition-colors" />
          </button>
          <button
            onClick={openSettings}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors"
            title="Settings"
          >
            <Settings size={12} className="text-white/50 hover:text-white/80 transition-colors" />
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-white/[0.06] my-2" />

      {/* Last transcript */}
      <div className="flex-1 min-h-0">
        {lastTranscript ? (
          <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">
            "{lastTranscript}"
          </p>
        ) : (
          <p className="text-xs text-white/30 italic">
            Press Ctrl+Shift+Space to start recording
          </p>
        )}
      </div>

      {/* spacer + system info footer */}
      <div className="flex items-center gap-3 text-[10px] text-white/40 mt-1">
        {systemInfo ? (
          <>
            <span className="flex items-center gap-1">
              <HardDrive size={10} />
              {systemInfo.available_ram_gb}GB free
            </span>
            <span className="text-white/10">|</span>
            <span className="text-white/50 font-medium">
              {currentModel || systemInfo.recommended_model?.model || 'no model'}
            </span>
            <span className="text-white/10">|</span>
            <span className="flex items-center gap-1">
              <Cpu size={10} />
              {systemInfo.gpu ? 'GPU' : 'CPU'}
            </span>
          </>
        ) : (
          <span>
            {connectionStatus === 'connected' ? 'Loading system info...' : 'Engine disconnected'}
          </span>
        )}
      </div>
    </div>
  );
}
