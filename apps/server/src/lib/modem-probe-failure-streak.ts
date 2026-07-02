import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

function streakDir(): string {
  return process.env.HUMA_MODEM_PROBE_STREAK_DIR?.trim() || '/run/huma';
}

/** SOCKS probe 연속 실패 N회부터 DB status=error (1회 타임아웃은 일시 지연) */
export const MODEM_PROBE_ERROR_STREAK = (() => {
  const raw = Number(process.env.HUMA_MODEM_PROBE_ERROR_STREAK);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
})();

function streakFile(slot: number): string {
  return join(streakDir(), `modem-probe-fail-slot${slot}.count`);
}

export function readProbeFailureStreak(slot: number): number {
  try {
    const raw = readFileSync(streakFile(slot), 'utf8').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function resetProbeFailureStreak(slot: number): void {
  try {
    unlinkSync(streakFile(slot));
  } catch {
    /* absent */
  }
}

/** @returns 갱신된 연속 실패 횟수 */
export function recordProbeFailureStreak(slot: number): number {
  const next = readProbeFailureStreak(slot) + 1;
  try {
    mkdirSync(streakDir(), { recursive: true });
    writeFileSync(streakFile(slot), String(next), 'utf8');
  } catch {
    /* dev / 권한 */
  }
  return next;
}

export type ProbeFailureDecision = {
  nextStatus: string;
  markError: boolean;
  clearPublicGeo: boolean;
  failureStreak: number;
};

/**
 * SOCKS probe 실패 시 — busy 유지, idle 등은 연속 실패 threshold 전까지 status 유지
 */
export function decideModemStatusAfterProbeFailure(
  currentStatus: string,
  failureStreak: number,
  threshold = MODEM_PROBE_ERROR_STREAK,
): ProbeFailureDecision {
  if (currentStatus === 'busy') {
    return {
      nextStatus: currentStatus,
      markError: false,
      clearPublicGeo: false,
      failureStreak,
    };
  }

  if (failureStreak >= threshold) {
    return {
      nextStatus: 'error',
      markError: true,
      clearPublicGeo: true,
      failureStreak,
    };
  }

  return {
    nextStatus: currentStatus === 'reconnecting' ? currentStatus : 'idle',
    markError: false,
    clearPublicGeo: false,
    failureStreak,
  };
}
