import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export { applyDonglePolicyRoute } from './dongle-policy-route.js';

const RESTORE_TIMEOUT_MS = 180_000;
const RESTORE_STATE_DIR = process.env.HUMA_DONGLE_RESTORE_STATE_DIR?.trim() || '/run/huma';
const RESTORE_LOCK_FILE =
  process.env.HUMA_DONGLE_RESTORE_LOCK_FILE?.trim() || `${RESTORE_STATE_DIR}/dongle-restore.lock`;
const RESTORE_LAST_FILE =
  process.env.HUMA_DONGLE_RESTORE_LAST_FILE?.trim() || `${RESTORE_STATE_DIR}/dongle-restore.last`;

/** 자동 복구 연속 실행 시 3proxy·policy route 전체 재적용으로 전 슬롯 지연 유발 방지 */
export const DONGLE_FULL_RESTORE_COOLDOWN_MS = (() => {
  const raw = Number(process.env.HUMA_DONGLE_FULL_RESTORE_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 180_000;
})();

export type RestoreDongleNetworkOptions = {
  /** UI 「동글 네트워크 복구」 — 쿨다운·락 대기 무시 */
  force?: boolean;
  /** SOCKS 자동 복구 — 5단계 naver curl 생략 (Node probe가 검증) */
  quick?: boolean;
};

export type RestoreDongleNetworkResult = {
  ok: boolean;
  output: string;
  error?: string;
  skipped?: 'cooldown' | 'locked';
};

function readLastRestoreMs(): number {
  try {
    const raw = readFileSync(RESTORE_LAST_FILE, 'utf8').trim();
    const ms = Number(raw);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

function markRestoreRan(): void {
  try {
    mkdirSync(RESTORE_STATE_DIR, { recursive: true });
    writeFileSync(RESTORE_LAST_FILE, String(Date.now()), 'utf8');
  } catch {
    /* dev / 권한 없음 */
  }
}

/** 자동 full restore 가 쿨다운 중인지 (테스트·recover 판단용) */
export function isDongleFullRestoreCooldownActive(
  nowMs = Date.now(),
  cooldownMs = DONGLE_FULL_RESTORE_COOLDOWN_MS,
  lastMs = readLastRestoreMs(),
): boolean {
  if (cooldownMs <= 0) return false;
  return lastMs > 0 && nowMs - lastMs < cooldownMs;
}

export function remainingDongleFullRestoreCooldownMs(
  nowMs = Date.now(),
  cooldownMs = DONGLE_FULL_RESTORE_COOLDOWN_MS,
  lastMs = readLastRestoreMs(),
): number {
  if (cooldownMs <= 0) return 0;
  if (lastMs <= 0) return 0;
  return Math.max(0, cooldownMs - (nowMs - lastMs));
}

function buildRestoreShell(scriptPath: string, options?: RestoreDongleNetworkOptions): string {
  const envParts: string[] = [];
  if (options?.quick) envParts.push('HUMA_RESTORE_SKIP_SOCKS_TEST=1');
  const envPrefix = envParts.length ? `${envParts.join(' ')} ` : '';
  const quoted = `"${scriptPath}"`;
  if (options?.force) {
    return `sudo ${envPrefix}bash ${quoted}`;
  }
  if (existsSync('/usr/bin/flock')) {
    return `flock -w 10 "${RESTORE_LOCK_FILE}" sudo ${envPrefix}bash ${quoted}`;
  }
  return `sudo ${envPrefix}bash ${quoted}`;
}

/** i7 — DHCP + policy routing + 3proxy (restore-dongle-by-subnet.sh) */
export function runRestoreDongleNetwork(
  options?: RestoreDongleNetworkOptions,
): RestoreDongleNetworkResult {
  if (process.platform === 'win32') {
    return { ok: false, output: '', error: '동글 네트워크 복구는 i7 Linux 서버에서만 실행됩니다.' };
  }

  if (!options?.force && isDongleFullRestoreCooldownActive()) {
    const remainSec = Math.ceil(remainingDongleFullRestoreCooldownMs() / 1000);
    return {
      ok: false,
      output: '',
      skipped: 'cooldown',
      error: `동글 일괄 복구 쿨다운 중 (${remainSec}s 남음) — 경량 routing·3proxy만 재시도`,
    };
  }

  const scriptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/restore-dongle-by-subnet.sh',
  );

  try {
    const output = execSync(buildRestoreShell(scriptPath, options), {
      encoding: 'utf8',
      timeout: RESTORE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    markRestoreRan();
    const tail = output.length > 6000 ? output.slice(-6000) : output;
    return { ok: true, output: tail };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    const combined = `${stdout}\n${stderr}`.trim();
    const tail = combined.length > 6000 ? combined.slice(-6000) : combined;
    const lockBusy = /flock:.*(failed|would block|Resource temporarily unavailable)/i.test(combined);
    if (lockBusy && !options?.force) {
      return {
        ok: false,
        output: tail,
        skipped: 'locked',
        error: '다른 동글 일괄 복구가 진행 중 — 경량 routing·3proxy만 재시도',
      };
    }
    return {
      ok: false,
      output: tail,
      error: stderr.slice(-800) || e.message || 'restore-dongle-by-subnet.sh 실패',
    };
  }
}
