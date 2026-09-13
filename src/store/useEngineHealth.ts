/**
 * X-Whisper — Engine Health Monitor Hook
 * 
 * Monitors the Python engine connection health via periodic pings.
 * Emits engine status events and handles reconnection.
 * Also provides engine_status and restart_engine Tauri commands.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from './useAppStore';
import { wsManager } from './useWebSocket';

const HEALTH_CHECK_INTERVAL = 10_000; // 10 seconds
const STARTUP_GRACE_PERIOD = 3_000;   // 3s grace for engine to start

export function useEngineHealth() {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    // Wait for initial grace period before starting health checks
    const startupTimer = setTimeout(() => {
      hasStarted.current = true;

      // If not connected after grace period, try connecting
      if (useAppStore.getState().connectionStatus !== 'connected') {
        wsManager.connect();
      }
    }, STARTUP_GRACE_PERIOD);

    // Periodic health check
    intervalRef.current = setInterval(() => {
      if (!hasStarted.current) return;

      const status = useAppStore.getState().connectionStatus;

      if (status === 'connected') {
        // Send a ping to verify connection is alive
        wsManager.send({ cmd: 'ping' });
      } else if (status === 'disconnected' || status === 'error') {
        // Try reconnecting
        wsManager.connect();
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => {
      clearTimeout(startupTimer);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return { connectionStatus };
}

/**
 * Get engine process status from Rust side
 */
export async function getEngineStatus(): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('engine_status');
  } catch {
    return 'unknown';
  }
}

/**
 * Restart the Python engine process via Rust
 */
export async function restartEngine(): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<string>('restart_engine');
    
    // Give engine time to start, then reconnect WebSocket
    setTimeout(() => {
      wsManager.connect();
    }, 2000);
    
    return result;
  } catch (e) {
    return `Failed: ${e}`;
  }
}
