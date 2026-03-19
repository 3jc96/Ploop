/**
 * Load diagnostics for debugging Android vs iOS performance differences.
 * Logs timing for each phase: permission, location, API.
 * Run the app in dev mode and check Metro/console for "[Ploop Load]" output.
 */
import { Platform } from 'react-native';

export interface LoadDiagnostics {
  platform: 'ios' | 'android' | 'web';
  permissionMs: number;
  locationSource: 'lastKnown' | 'currentPosition' | 'timeout';
  locationMs: number;
  apiMs: number;
  totalMs: number;
  success: boolean;
}

let diagnostics: Partial<LoadDiagnostics> = {};

export function startLoadDiagnostics(): void {
  diagnostics = {
    platform: Platform.OS as 'ios' | 'android' | 'web',
    permissionMs: 0,
    locationSource: 'currentPosition',
    locationMs: 0,
    apiMs: 0,
    totalMs: 0,
    success: false,
  };
  (diagnostics as any)._start = Date.now();
}

export function markPermissionDone(): void {
  const start = (diagnostics as any)._start;
  if (typeof start === 'number') {
    diagnostics.permissionMs = Date.now() - start;
  }
}

export function markLocationDone(source: 'lastKnown' | 'currentPosition' | 'timeout', startMs?: number): void {
  diagnostics.locationSource = source;
  const start = startMs ?? (diagnostics as any)._locationStart;
  if (typeof start === 'number') {
    diagnostics.locationMs = Date.now() - start;
  }
}

export function startLocationPhase(): void {
  (diagnostics as any)._locationStart = Date.now();
}

export function markApiDone(startMs?: number): void {
  const start = startMs ?? (diagnostics as any)._apiStart;
  if (typeof start === 'number') {
    diagnostics.apiMs = Date.now() - start;
  }
}

export function startApiPhase(): void {
  (diagnostics as any)._apiStart = Date.now();
}

export function finishLoadDiagnostics(success: boolean): LoadDiagnostics | null {
  const start = (diagnostics as any)._start;
  if (typeof start === 'number') {
    diagnostics.totalMs = Date.now() - start;
    diagnostics.success = success;
  }
  const result = diagnostics as LoadDiagnostics;
  if (__DEV__ && result.platform) {
    const parts = [
      `[Ploop Load] ${result.platform}`,
      `total=${result.totalMs}ms`,
      `perm=${result.permissionMs}ms`,
      `loc=${result.locationMs}ms (${result.locationSource})`,
      `api=${result.apiMs}ms`,
      result.success ? '✓' : '✗',
    ];
    console.log(parts.join(' | '));
  }
  return result.platform ? result : null;
}

/** Call after finishLoadDiagnostics to send to backend (production + dev) */
export async function sendLoadDiagnosticsToBackend(result: LoadDiagnostics | null): Promise<void> {
  if (!result?.platform) return;
  try {
    const { api } = await import('../services/api');
    await api.submitLoadDiagnostics({
      platform: result.platform,
      permissionMs: result.permissionMs,
      locationSource: result.locationSource,
      locationMs: result.locationMs,
      apiMs: result.apiMs,
      totalMs: result.totalMs,
      success: result.success,
    });
  } catch {
    // ignore
  }
}

export function getLastLoadDiagnostics(): LoadDiagnostics | null {
  return diagnostics.platform ? (diagnostics as LoadDiagnostics) : null;
}
