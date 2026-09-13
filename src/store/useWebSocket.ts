/**
 * X-Whisper — WebSocket Client Hook
 * 
 * Manages the WebSocket connection to the Python sidecar engine.
 * Handles auto-reconnect with exponential backoff, event parsing,
 * and provides a command-sending interface.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from './useAppStore';

// ── Types ────────────────────────────────────────────────────

interface WSCommand {
  cmd: string;
  [key: string]: unknown;
}

interface WSEvent {
  event: string;
  [key: string]: unknown;
}

// ── Constants ────────────────────────────────────────────────

const WS_URL = 'ws://localhost:9876';
const RECONNECT_BASE_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 30000;  // 30 seconds
const RECONNECT_MAX_ATTEMPTS = 50;

// ── Singleton WebSocket Manager ──────────────────────────────

class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;
  private eventHandlers: Map<string, Set<(data: WSEvent) => void>> = new Map();

  // Store references for updating state
  private getStore = () => useAppStore.getState();

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.isIntentionalClose = false;
    this.getStore().setConnectionStatus('connecting');

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS] Connected to X-Whisper Engine');
        this.reconnectAttempts = 0;
        this.getStore().setConnectionStatus('connected');

        // Request system info, saved settings, and cloud key status on connect
        this.send({ cmd: 'get_system_info' });
        this.send({ cmd: 'get_settings' });
        this.send({ cmd: 'get_groq_key_status' });
        this.send({ cmd: 'get_presets' });
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WSEvent = JSON.parse(event.data);
          this.handleEvent(data);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Disconnected (code: ${event.code})`);
        this.getStore().setConnectionStatus('disconnected');

        if (!this.isIntentionalClose) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        this.getStore().setConnectionStatus('error');
      };
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      this.getStore().setConnectionStatus('error');
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.isIntentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.getStore().setConnectionStatus('disconnected');
  }

  send(command: WSCommand) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
      console.log('[WS] Sent:', command.cmd);
    } else {
      console.warn('[WS] Cannot send — not connected. Cmd:', command.cmd);
    }
  }

  on(event: string, handler: (data: WSEvent) => void) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: (data: WSEvent) => void) {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private handleEvent(data: WSEvent) {
    const store = this.getStore();
    const event = data.event;

    console.log('[WS] Event:', event, data);

    switch (event) {
      case 'pong':
        // Connection alive confirmation
        break;

      case 'system_info':
        store.setSystemInfo({
          total_ram_gb: data.total_ram_gb as number,
          available_ram_gb: data.available_ram_gb as number,
          used_ram_gb: data.used_ram_gb as number,
          ram_percent: data.ram_percent as number,
          cpu_count: data.cpu_count as number,
          cpu_freq_mhz: data.cpu_freq_mhz as number | null,
          platform: data.platform as string,
          platform_version: data.platform_version as string,
          gpu: data.gpu as string | null,
          recommended_model: data.recommended_model as {
            model: string;
            compute_type: string;
            device: string;
            beam_size: number;
          },
          has_gpu: data.has_gpu as boolean | undefined,
          vram_gb: data.vram_gb as number | null | undefined,
          hardware_tier: data.hardware_tier as 'low' | 'mid' | 'high' | 'beast' | undefined,
          preset: data.preset as 'instant' | 'balanced' | 'accurate' | 'turbo_cloud' | 'custom' | undefined,
        });
        // Restore model state from engine status
        if (data.engine_status) {
          const es = data.engine_status as { loaded: boolean; model: string | null };
          if (es.loaded && es.model) {
            store.setCurrentModel(es.model);
            store.setModelReady(true);
          }
        }
        break;

      case 'recording_start':
        store.setAppState('recording');
        store.setPartialTranscript('');
        store.setPartialSegmentId(0);
        break;

      case 'recording_stop':
        store.setAppState('transcribing');
        break;

      case 'transcribing':
        store.setAppState('transcribing');
        store.setIsTranscribing(true);
        break;

      case 'transcript':
        store.setLastTranscript(data.text as string);
        store.setAppState('idle');
        store.setIsTranscribing(false);
        store.setPartialTranscript('');
        store.setPartialSegmentId(0);
        break;

      case 'partial_transcript':
        store.setPartialTranscript(data.text as string);
        store.setPartialSegmentId(data.segment_id as number ?? 0);
        break;

      case 'waveform':
        store.pushAmplitude(data.amplitude as number);
        break;

      case 'model_ready':
        store.setCurrentModel(data.model as string);
        store.setModelReady(true);
        store.setLoadingModel(null);
        store.setNoModelCTA(null);
        break;

      case 'model_loading':
        store.setModelReady(false);
        store.setLoadingModel(data.model as string ?? 'unknown');
        break;

      case 'model_warming':
        store.setLoadingModel(data.model as string ?? 'unknown');
        break;

      case 'model_unloaded':
        store.setCurrentModel(null);
        store.setModelReady(false);
        store.setLoadingModel(null);
        break;

      case 'model_list':
        store.setModelList(data.models as any[]);
        break;

      case 'download_progress':
        store.setDownloadingModel(data.model as string);
        store.setDownloadProgress(data.percent as number);
        break;

      case 'download_complete':
        store.setDownloadingModel(null);
        store.setDownloadProgress(0);
        // Refresh model list
        this.send({ cmd: 'list_models' });
        break;

      case 'download_cancelled':
        store.setDownloadingModel(null);
        store.setDownloadProgress(0);
        break;

      case 'model_deleted':
        // Refresh model list
        this.send({ cmd: 'list_models' });
        break;

      case 'settings':
      case 'settings_saved':
        if (data.settings) {
          const s = data.settings as Record<string, unknown>;
          store.updateSettings({
            autoPaste: s.auto_paste as boolean ?? true,
            language: s.language as string ?? 'auto',
            hotkey: s.hotkey as string ?? 'Ctrl+Shift+Space',
            beamSize: s.beam_size as number ?? 1,
            offlineOnly: s.offline_only as boolean ?? true,
            provider: (s.provider as 'local' | 'cloud') ?? 'local',
            preset: (s.preset as 'instant' | 'balanced' | 'accurate' | 'turbo_cloud' | 'custom') ?? 'custom',
            streaming: s.streaming as boolean ?? true,
            streamIntervalMs: s.stream_interval_ms as number ?? 2000,
            streamMinSec: s.stream_min_sec as number ?? 1.5,
            streamWindowSec: s.stream_window_sec as number ?? 30.0,
            initialPrompt: (s.initial_prompt as string) ?? '',
            saveHistory: s.save_history as boolean ?? true,
            islandVisibility: (['always', 'speaking', 'hidden'] as const).includes(s.island_visibility as any)
              ? (s.island_visibility as 'always' | 'speaking' | 'hidden')
              : 'always',
            onboardingCompleted: Boolean(s.onboarding_completed),
          });
          store.setSettingsLoaded(true);
        }
        break;

      case 'groq_key_status':
        store.setGroqKeyStatus({
          hasKey: Boolean(data.has_key),
          masked: (data.masked as string) ?? '',
        });
        break;

      case 'groq_key_set':
        if (data.success) {
          store.setGroqKeyStatus({
            hasKey: true,
            masked: (data.masked as string) ?? '',
          });
          store.setGroqKeyTestResult({
            ok: true,
            models: data.models as string[] | undefined,
          });
          // Cloud presets become resolvable once a key exists.
          this.send({ cmd: 'get_presets' });
        } else {
          store.setGroqKeyTestResult({
            ok: false,
            error: data.error as string | undefined,
            message: data.message as string | undefined,
          });
        }
        break;

      case 'groq_key_tested':
        store.setGroqKeyTestResult({
          ok: Boolean(data.ok),
          error: data.error as string | undefined,
          message: data.message as string | undefined,
          models: data.models as string[] | undefined,
        });
        break;

      case 'presets':
        store.setPresetCatalog((data.presets as any[]) ?? []);
        if (data.hardware) {
          store.setHardwareProfile(data.hardware as any);
        }
        if (data.current) {
          store.updateSettings({ preset: data.current as any });
        }
        break;

      case 'preset_applied':
        store.setApplyingPreset(null);
        if (data.preset) {
          store.updateSettings({ preset: data.preset as any });
        }
        // Refresh the catalog so the resolved model columns reflect the new state.
        this.send({ cmd: 'get_presets' });
        break;

      case 'groq_key_cleared':
        store.setGroqKeyStatus({ hasKey: false, masked: '' });
        store.setGroqKeyTestResult(null);
        this.send({ cmd: 'get_presets' });
        break;

      case 'transcript_history':
        store.setTranscriptHistory((data.entries as any[]) ?? []);
        break;

      case 'transcript_history_appended':
        if (data.entry) {
          store.prependTranscript(data.entry as any);
        }
        break;

      case 'transcript_deleted':
        if (data.id) {
          store.removeTranscript(data.id as string);
        }
        break;

      case 'transcript_history_cleared':
        store.setTranscriptHistory([]);
        break;

      case 'file_transcribe_started':
        store.setFileResult(null);
        store.setFileJobError(null);
        store.setFileJob({
          id: data.job_id as string,
          filename: (data.filename as string) ?? 'audio',
          path: (data.path as string) ?? '',
          provider: (data.provider as string | null) ?? null,
          model: (data.model as string | null) ?? null,
          wantSrt: Boolean(data.want_srt),
          percent: 0,
          startedAt: Date.now(),
        });
        break;

      case 'file_transcribe_progress':
        store.updateFileJobPercent(
          data.job_id as string,
          Number(data.percent ?? 0),
        );
        break;

      case 'file_transcribe_complete': {
        const currentJob = store.fileJob;
        const filename = (data.filename as string) ?? currentJob?.filename ?? 'audio';
        store.setFileJob(null);
        if (data.success) {
          store.setFileResult({
            jobId: data.job_id as string,
            filename,
            path: (data.path as string) ?? currentJob?.path ?? '',
            text: (data.text as string) ?? '',
            srt: (data.srt as string | null) ?? null,
            language: (data.language as string | null) ?? null,
            duration: (data.duration as number | null) ?? null,
            provider: (data.provider as string | null) ?? null,
            model: (data.model as string | null) ?? null,
            savedToHistory: false,
          });
          store.setFileJobError(null);
        } else if (data.cancelled) {
          store.setFileJobError(null);
        } else {
          store.setFileJobError({
            code: (data.error as string) ?? 'transcribe_failed',
            message: (data.message as string) ?? 'File transcription failed.',
            filename,
          });
        }
        break;
      }

      case 'file_job_busy':
        store.setFileJobError({
          code: 'busy',
          message: (data.message as string) ?? 'Another file is being transcribed.',
        });
        break;

      case 'file_transcript_saved':
        if (data.id) {
          const current = store.fileResult;
          if (current) store.markFileResultSaved(current.jobId);
        }
        break;

      case 'file_transcribe_cancel_ack':
        // No state change needed — the complete event clears the job.
        break;

      case 'error':
        store.setLastError({
          code: data.code as string,
          message: data.message as string,
        });
        // Reset states on certain errors
        if (data.code === 'no_audio' || data.code === 'transcription_failed' || data.code === 'no_model') {
          store.setAppState('idle');
          store.setIsTranscribing(false);
        }
        // First-run CTA: hotkey pressed before a model is ready. Backend
        // tags this payload with `model` + `status` so the island can
        // render a dedicated pill instead of the generic error toast.
        if (data.code === 'no_model' && data.model && data.status) {
          store.setNoModelCTA({
            model: data.model as string,
            status: data.status as 'downloading' | 'loading',
            message: (data.message as string) ?? '',
          });
        }
        // A failed load never sends model_ready, so clear the loading
        // pill defensively — otherwise the UI stays stuck. The engine
        // tags load errors with the model id when known.
        if (store.loadingModel && (data.model === undefined || data.model === store.loadingModel)) {
          store.setLoadingModel(null);
        }
        console.error(`[WS] Engine error: ${data.code} — ${data.message}`);
        break;

      default:
        console.log('[WS] Unhandled event:', event);
    }

    // Notify external event handlers
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error('[WS] Max reconnect attempts reached');
      this.getStore().setConnectionStatus('error');
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const wsManager = new WebSocketManager();

// ── React Hook ───────────────────────────────────────────────

export function useWebSocket() {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const hasConnected = useRef(false);

  useEffect(() => {
    if (!hasConnected.current) {
      hasConnected.current = true;
      wsManager.connect();
    }

    return () => {
      // Don't disconnect on unmount — keep the connection alive
      // wsManager.disconnect();
    };
  }, []);

  const sendCommand = useCallback((cmd: string, data?: Record<string, unknown>) => {
    wsManager.send({ cmd, ...data });
  }, []);

  return {
    connectionStatus,
    sendCommand,
    isConnected: connectionStatus === 'connected',
    wsManager,
  };
}
