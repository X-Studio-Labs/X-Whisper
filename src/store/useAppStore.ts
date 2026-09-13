/**
 * X-Whisper — Global Application State (Zustand)
 * 
 * Central state management for the entire application.
 * Manages app state, transcription results, model info, and system data.
 */

import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────────

export type AppState = 'idle' | 'recording' | 'transcribing' | 'error';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type SettingsSection =
  | 'general'
  | 'models'
  | 'cloud'
  | 'hotkey'
  | 'history'
  | 'audio'
  | 'appearance'
  | 'about';

export interface SystemInfo {
  total_ram_gb: number;
  available_ram_gb: number;
  used_ram_gb: number;
  ram_percent: number;
  cpu_count: number;
  cpu_freq_mhz: number | null;
  platform: string;
  platform_version: string;
  gpu: string | null;
  recommended_model: {
    model: string;
    compute_type: string;
    device: string;
    beam_size: number;
  };
  // Phase 16 additions
  has_gpu?: boolean;
  vram_gb?: number | null;
  hardware_tier?: HardwareTier;
  preset?: PresetName;
}

export type HardwareTier = 'low' | 'mid' | 'high' | 'beast';
export type PresetName = 'instant' | 'balanced' | 'accurate' | 'turbo_cloud' | 'custom';

export interface PresetCatalogEntry {
  preset: PresetName;
  model_id: string;
  display: string;
  provider: string;
  device: string;
  compute_type: string;
  beam_size: number;
  requires_network: boolean;
  reason: string;
  available: boolean;
}

export interface HardwareProfile {
  ram_gb: number;
  available_ram_gb: number;
  cpu_cores: number;
  cpu_freq_mhz: number | null;
  gpu_name: string | null;
  vram_gb: number | null;
  has_gpu: boolean;
  tier: HardwareTier;
  platform: string;
}

export interface ModelInfo {
  name: string;
  isLoaded: boolean;
  isDownloaded: boolean;
  downloadProgress: number;
  sizeMb: number;
  minRamGb: number;
}

export interface ModelListItem {
  /** X- model ID (e.g. "x-large-v3"). */
  id: string;
  /** Kept equal to `id` for back-compat with the old shape. */
  name: string;
  /** Human-readable label (e.g. "X-Large v3"). */
  display: string;
  /** Backend provider key: "faster_whisper" | "groq". */
  provider: string;
  /** Upstream HuggingFace repo ID or Groq model name. */
  repo: string;
  size_mb: number;
  min_ram_gb: number;
  gpu_preferred?: boolean;
  /** ISO language codes the model supports (or ["auto", ...]). */
  languages: string[];
  /** 0 – 1 accuracy score used by MetricBar. */
  accuracy: number;
  /** 0 – 1 speed score used by MetricBar. */
  speed: number;
  /** Extra pip packages the provider needs (empty for faster-whisper). */
  requires_extra_deps: string[];
  /** True for Groq / cloud entries. */
  requires_network: boolean;
  downloaded: boolean;
  disk_size_mb: number;
  local_path: string | null;
}

/** Dynamic Island overlay visibility. `speaking` = only while recording,
 *  transcribing, or showing a result; `hidden` = never (hotkey still works). */
export type IslandVisibility = 'always' | 'speaking' | 'hidden';

export interface UserSettings {
  autoPaste: boolean;
  language: string;
  hotkey: string;
  beamSize: number;
  offlineOnly: boolean;
  provider: 'local' | 'cloud';
  preset: PresetName;
  streaming: boolean;
  streamIntervalMs: number;
  streamMinSec: number;
  streamWindowSec: number;
  initialPrompt: string;
  saveHistory: boolean;
  islandVisibility: IslandVisibility;
  onboardingCompleted: boolean;
}

export interface TranscriptHistoryEntry {
  id: string;
  text: string;
  language: string | null;
  duration: number | null;
  model: string | null;
  provider: string | null;
  created_at: string;
}

export interface FileTranscribeJob {
  id: string;
  filename: string;
  path: string;
  provider: string | null;
  model: string | null;
  wantSrt: boolean;
  percent: number;
  startedAt: number;
}

export interface FileTranscribeResult {
  jobId: string;
  filename: string;
  path: string;
  text: string;
  srt: string | null;
  language: string | null;
  duration: number | null;
  provider: string | null;
  model: string | null;
  savedToHistory: boolean;
}

export interface GroqKeyStatus {
  hasKey: boolean;
  masked: string;
}

export interface AppStore {
  // ── App State ──────────────────────────────────────────────
  appState: AppState;
  setAppState: (state: AppState) => void;

  // ── Connection ─────────────────────────────────────────────
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  // ── Recording ──────────────────────────────────────────────
  recordingDuration: number;
  setRecordingDuration: (duration: number) => void;
  amplitude: number;
  setAmplitude: (amplitude: number) => void;
  amplitudeHistory: number[];
  pushAmplitude: (amplitude: number) => void;

  // ── Transcription ──────────────────────────────────────────
  lastTranscript: string;
  setLastTranscript: (text: string) => void;
  isTranscribing: boolean;
  setIsTranscribing: (value: boolean) => void;
  partialTranscript: string;
  setPartialTranscript: (text: string) => void;
  partialSegmentId: number;
  setPartialSegmentId: (id: number) => void;

  // ── System Info ────────────────────────────────────────────
  systemInfo: SystemInfo | null;
  setSystemInfo: (info: SystemInfo) => void;

  // ── Model ──────────────────────────────────────────────────
  currentModel: string | null;
  setCurrentModel: (model: string | null) => void;
  modelReady: boolean;
  setModelReady: (ready: boolean) => void;

  // ── Error ──────────────────────────────────────────────────
  lastError: { code: string; message: string } | null;
  setLastError: (error: { code: string; message: string } | null) => void;

  // ── Hotkey-with-no-model CTA ───────────────────────────────
  noModelCTA: { model: string; status: 'downloading' | 'loading'; message: string } | null;
  setNoModelCTA: (cta: { model: string; status: 'downloading' | 'loading'; message: string } | null) => void;

  // ── Island State ───────────────────────────────────────────
  isHovered: boolean;
  setIsHovered: (hovered: boolean) => void;

  // ── Settings Window ────────────────────────────────────────
  activeSection: SettingsSection;
  setActiveSection: (section: SettingsSection) => void;

  // ── Model List ─────────────────────────────────────────────
  modelList: ModelListItem[];
  setModelList: (list: ModelListItem[]) => void;
  downloadingModel: string | null;
  setDownloadingModel: (model: string | null) => void;
  downloadProgress: number;
  setDownloadProgress: (progress: number) => void;
  loadingModel: string | null;
  setLoadingModel: (model: string | null) => void;

  // ── User Settings ──────────────────────────────────────────
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
  /** True once the engine has replayed persisted settings at least once. */
  settingsLoaded: boolean;
  setSettingsLoaded: (loaded: boolean) => void;

  // ── Transcript History (v1.1) ──────────────────────────────
  transcriptHistory: TranscriptHistoryEntry[];
  setTranscriptHistory: (entries: TranscriptHistoryEntry[]) => void;
  prependTranscript: (entry: TranscriptHistoryEntry) => void;
  removeTranscript: (id: string) => void;

  // ── File Transcribe (Phase 19) ─────────────────────────────
  fileJob: FileTranscribeJob | null;
  setFileJob: (job: FileTranscribeJob | null) => void;
  updateFileJobPercent: (jobId: string, percent: number) => void;
  fileResult: FileTranscribeResult | null;
  setFileResult: (result: FileTranscribeResult | null) => void;
  markFileResultSaved: (jobId: string) => void;
  fileJobError: { code: string; message: string; filename?: string } | null;
  setFileJobError: (err: { code: string; message: string; filename?: string } | null) => void;

  // ── Presets (Phase 16) ─────────────────────────────────────
  presetCatalog: PresetCatalogEntry[];
  setPresetCatalog: (catalog: PresetCatalogEntry[]) => void;
  hardwareProfile: HardwareProfile | null;
  setHardwareProfile: (profile: HardwareProfile | null) => void;
  applyingPreset: PresetName | null;
  setApplyingPreset: (preset: PresetName | null) => void;

  // ── Cloud / Groq Key ───────────────────────────────────────
  groqKeyStatus: GroqKeyStatus;
  setGroqKeyStatus: (status: GroqKeyStatus) => void;
  groqKeyTestResult: { ok: boolean; error?: string; message?: string; models?: string[] } | null;
  setGroqKeyTestResult: (result: { ok: boolean; error?: string; message?: string; models?: string[] } | null) => void;

  // ── Actions ────────────────────────────────────────────────
  reset: () => void;
}

// ── Store ────────────────────────────────────────────────────

const defaultSettings: UserSettings = {
  autoPaste: true,
  language: 'auto',
  hotkey: 'Ctrl+Shift+Space',
  beamSize: 1,
  offlineOnly: true,
  provider: 'local',
  preset: 'custom',
  streaming: true,
  streamIntervalMs: 2000,
  streamMinSec: 1.5,
  streamWindowSec: 30.0,
  initialPrompt: '',
  saveHistory: true,
  islandVisibility: 'always',
  onboardingCompleted: false,
};

const defaultGroqKeyStatus: GroqKeyStatus = {
  hasKey: false,
  masked: '',
};

const initialState = {
  appState: 'idle' as AppState,
  connectionStatus: 'disconnected' as ConnectionStatus,
  recordingDuration: 0,
  amplitude: 0,
  amplitudeHistory: Array(40).fill(0.01),
  lastTranscript: '',
  isTranscribing: false,
  partialTranscript: '',
  partialSegmentId: 0,
  systemInfo: null as SystemInfo | null,
  currentModel: null as string | null,
  modelReady: false,
  lastError: null as { code: string; message: string } | null,
  noModelCTA: null as { model: string; status: 'downloading' | 'loading'; message: string } | null,
  isHovered: false,
  activeSection: 'general' as SettingsSection,
  modelList: [] as ModelListItem[],
  downloadingModel: null as string | null,
  downloadProgress: 0,
  loadingModel: null as string | null,
  settings: defaultSettings,
  settingsLoaded: false,
  transcriptHistory: [] as TranscriptHistoryEntry[],
  fileJob: null as FileTranscribeJob | null,
  fileResult: null as FileTranscribeResult | null,
  fileJobError: null as { code: string; message: string; filename?: string } | null,
  groqKeyStatus: defaultGroqKeyStatus,
  groqKeyTestResult: null as AppStore['groqKeyTestResult'],
  presetCatalog: [] as PresetCatalogEntry[],
  hardwareProfile: null as HardwareProfile | null,
  applyingPreset: null as PresetName | null,
};

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,

  // Setters
  setAppState: (appState) => set({ appState }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  setAmplitude: (amplitude) => set({ amplitude }),
  pushAmplitude: (amp) => set((state) => {
    // Keep last 40 frames (~2 seconds of audio at 50ms intervals)
    const newHistory = [...state.amplitudeHistory, Math.max(0.01, amp)];
    if (newHistory.length > 40) newHistory.shift();
    return { amplitude: amp, amplitudeHistory: newHistory };
  }),
  setLastTranscript: (lastTranscript) => set({ lastTranscript }),
  setIsTranscribing: (isTranscribing) => set({ isTranscribing }),
  setPartialTranscript: (partialTranscript) => set({ partialTranscript }),
  setPartialSegmentId: (partialSegmentId) => set({ partialSegmentId }),
  setSystemInfo: (systemInfo) => set({ systemInfo }),
  setCurrentModel: (currentModel) => set({ currentModel }),
  setModelReady: (modelReady) => set({ modelReady }),
  setLastError: (lastError) => set({ lastError }),
  setNoModelCTA: (noModelCTA) => set({ noModelCTA }),
  setIsHovered: (isHovered) => set({ isHovered }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setModelList: (modelList) => set({ modelList }),
  setDownloadingModel: (downloadingModel) => set({ downloadingModel }),
  setDownloadProgress: (downloadProgress) => set({ downloadProgress }),
  setLoadingModel: (loadingModel) => set({ loadingModel }),
  updateSettings: (partial) => set((state) => ({
    settings: { ...state.settings, ...partial },
  })),
  setSettingsLoaded: (settingsLoaded) => set({ settingsLoaded }),
  setTranscriptHistory: (transcriptHistory) => set({ transcriptHistory }),
  prependTranscript: (entry) => set((state) => ({
    transcriptHistory: [entry, ...state.transcriptHistory.filter((e) => e.id !== entry.id)].slice(0, 50),
  })),
  removeTranscript: (id) => set((state) => ({
    transcriptHistory: state.transcriptHistory.filter((e) => e.id !== id),
  })),
  setFileJob: (fileJob) => set({ fileJob }),
  updateFileJobPercent: (jobId, percent) => set((state) => (
    state.fileJob && state.fileJob.id === jobId
      ? { fileJob: { ...state.fileJob, percent } }
      : {}
  )),
  setFileResult: (fileResult) => set({ fileResult }),
  markFileResultSaved: (jobId) => set((state) => (
    state.fileResult && state.fileResult.jobId === jobId
      ? { fileResult: { ...state.fileResult, savedToHistory: true } }
      : {}
  )),
  setFileJobError: (fileJobError) => set({ fileJobError }),
  setGroqKeyStatus: (groqKeyStatus) => set({ groqKeyStatus }),
  setGroqKeyTestResult: (groqKeyTestResult) => set({ groqKeyTestResult }),
  setPresetCatalog: (presetCatalog) => set({ presetCatalog }),
  setHardwareProfile: (hardwareProfile) => set({ hardwareProfile }),
  setApplyingPreset: (applyingPreset) => set({ applyingPreset }),

  // Reset to initial state
  reset: () => set({
    ...initialState,
    amplitudeHistory: Array(40).fill(0.01),
  }),
}));
