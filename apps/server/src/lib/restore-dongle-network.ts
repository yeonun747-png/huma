import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export { applyDonglePolicyRoute } from './dongle-policy-route.js';

const RESTORE_TIMEOUT_MS = 180_000;
const SLOT_RESTORE_TIMEOUT_MS = 90_000;
/** flock 대기(초) — 다른 슬롯 복구와 겹칠 때 */
const RESTORE_FLOCK_WAIT_SEC = (() => {
  const raw = Number(process.env.HUMA_DONGLE_RESTORE_FLOCK_WAIT_SEC);
  return Number.isFinite(raw) && raw >= 5 ? Math.floor(raw) : 30;
})();
const SUDO_BIN = process.env.HUMA_RESTORE_SUDO?.trim() || '/usr/bin/sudo';
const BASH_BIN = process.env.HUMA_RESTORE_BASH?.trim() || '/usr/bin/bash';
const RESTORE_STATE_DIR = process.env.HUMA_DONGLE_RESTORE_STATE_DIR?.trim() || '/run/huma';
const RESTORE_LOCK_FILE =
  process.env.HUMA_DONGLE_RESTORE_LOCK_FILE?.trim() || `${RESTORE_STATE_DIR}/dongle-restore.lock`;
const RESTORE_LAST_FILE =
  process.env.HUMA_DONGLE_RESTORE_LAST_FILE?.trim() || `${RESTORE_STATE_DIR}/dongle-restore.last`;

/** 자동 슬롯 복구 연속 실행 방지 (슬롯별) */
export const DONGLE_SLOT_RESTORE_COOLDOWN_MS = (() => {
  const raw = Number(process.env.HUMA_DONGLE_SLOT_RESTORE_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
})();

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

export type RestoreDongleSlotResult = RestoreDongleNetworkResult;

function slotRestoreLastFile(slot: number): string {
  return `${RESTORE_STATE_DIR}/dongle-restore-slot${slot}.last`;
}

function slotRestoreLockFile(slot: number): string {
  return `${RESTORE_STATE_DIR}/dongle-restore-slot${slot}.lock`;
}

function readSlotRestoreMs(slot: number): number {
  try {
    const raw = readFileSync(slotRestoreLastFile(slot), 'utf8').trim();
    const ms = Number(raw);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

function markSlotRestoreRan(slot: number): void {
  try {
    mkdirSync(RESTORE_STATE_DIR, { recursive: true });
    writeFileSync(slotRestoreLastFile(slot), String(Date.now()), 'utf8');
  } catch {
    /* dev */
  }
}

export function isDongleSlotRestoreCooldownActive(
  slot: number,
  nowMs = Date.now(),
  cooldownMs = DONGLE_SLOT_RESTORE_COOLDOWN_MS,
  lastMs = readSlotRestoreMs(slot),
): boolean {
  if (cooldownMs <= 0) return false;
  return lastMs > 0 && nowMs - lastMs < cooldownMs;
}

export function remainingDongleSlotRestoreCooldownMs(
  slot: number,
  nowMs = Date.now(),
  cooldownMs = DONGLE_SLOT_RESTORE_COOLDOWN_MS,
  lastMs = readSlotRestoreMs(slot),
): number {
  if (cooldownMs <= 0) return 0;
  if (lastMs <= 0) return 0;
  return Math.max(0, cooldownMs - (nowMs - lastMs));
}

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

/** execSync 실패 시 stdout·stderr에서 사용자용 원인 추출 */
export function formatRestoreExecError(combinedOutput: string, execMessage?: string): string {
  const lines = combinedOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const sudoLine = [...lines].reverse().find((l) => /sudo:/i.test(l));
  if (sudoLine) {
    if (/password is required|a terminal is required|not allowed/i.test(sudoLine)) {
      return `${sudoLine} — i7에서 sudo HUMA_USER=songchunho bash apps/server/deploy/setup-huma-modem-sudoers.sh 실행 후 pm2 restart huma-server`;
    }
    return sudoLine;
  }

  const scriptLine = [...lines]
    .reverse()
    .find((l) => /^(오류|error|✗|⚠)/i.test(l) || /실패|없음|NOT LISTEN|FAIL/i.test(l));
  if (scriptLine) return scriptLine;

  const tail = lines.slice(-4).join(' | ');
  if (tail) return tail;

  if (execMessage && !/^Command failed:/i.test(execMessage)) return execMessage;
  return 'restore-dongle-by-subnet.sh 실패 — i7에서 동글 USB·LTE·sudoers 확인';
}

/** flock 잠금 메시지 (en/ko) */
export function isRestoreFlockBusyError(text: string): boolean {
  return /flock:.*(failed|would block|Resource temporarily unavailable|잠긴|잠금)/i.test(text);
}

function buildRestoreShell(scriptPath: string, options?: RestoreDongleNetworkOptions): string {
  const scriptArgs = options?.quick ? ' --skip-socks-test' : '';
  const quoted = `"${scriptPath}"`;
  const sudo = `${SUDO_BIN} -n`;
  const bash = BASH_BIN;
  if (options?.force) {
    return `${sudo} ${bash} ${quoted}${scriptArgs}`;
  }
  if (existsSync('/usr/bin/flock')) {
    return `flock -w ${RESTORE_FLOCK_WAIT_SEC} "${RESTORE_LOCK_FILE}" ${sudo} ${bash} ${quoted}${scriptArgs}`;
  }
  return `${sudo} ${bash} ${quoted}${scriptArgs}`;
}

function buildSlotRestoreShell(scriptPath: string, slot: number): string {
  const quoted = `"${scriptPath}"`;
  const sudo = `${SUDO_BIN} -n`;
  const bash = BASH_BIN;
  const lock = slotRestoreLockFile(slot);
  if (existsSync('/usr/bin/flock')) {
    return `flock -w ${RESTORE_FLOCK_WAIT_SEC} "${lock}" ${sudo} ${bash} ${quoted} ${slot}`;
  }
  return `${sudo} ${bash} ${quoted} ${slot}`;
}

function mapRestoreExecFailure(
  combined: string,
  stderr: string,
  execMessage?: string,
  fallback = 'restore-dongle-by-subnet.sh 실패',
): string {
  return formatRestoreExecError(combined, execMessage) || stderr.slice(-800) || execMessage || fallback;
}

/** 포스팅 동글 단일 슬롯 — DHCP·route·3proxy reload (다른 슬롯 유지) */
export function runRestoreDongleSlot(slot: number): RestoreDongleSlotResult {
  if (process.platform === 'win32') {
    return { ok: false, output: '', error: '동글 슬롯 복구는 i7 Linux 서버에서만 실행됩니다.' };
  }
  if (slot < 1 || slot > 5) {
    return { ok: false, output: '', error: `슬롯 ${slot} — 포스팅 동글은 1~5` };
  }

  if (isDongleSlotRestoreCooldownActive(slot)) {
    const remainSec = Math.ceil(remainingDongleSlotRestoreCooldownMs(slot) / 1000);
    return {
      ok: false,
      output: '',
      skipped: 'cooldown',
      error: `슬롯${slot} 복구 쿨다운 중 (${remainSec}s 남음)`,
    };
  }

  const scriptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../scripts/restore-dongle-slot.sh',
  );

  try {
    const output = execSync(buildSlotRestoreShell(scriptPath, slot), {
      encoding: 'utf8',
      timeout: SLOT_RESTORE_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    });
    markSlotRestoreRan(slot);
    const tail = output.length > 4000 ? output.slice(-4000) : output;
    return { ok: true, output: tail };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '';
    const combined = `${stdout}\n${stderr}`.trim();
    const tail = combined.length > 4000 ? combined.slice(-4000) : combined;
    const lockBusy = isRestoreFlockBusyError(combined);
    if (lockBusy) {
      return {
        ok: false,
        output: tail,
        skipped: 'locked',
        error: `슬롯${slot} 복구가 이미 진행 중`,
      };
    }
    return {
      ok: false,
      output: tail,
      error: mapRestoreExecFailure(combined, stderr, e.message, 'restore-dongle-slot.sh 실패'),
    };
  }
}

/** i7 — DHCP + policy routing + 3proxy (restore-dongle-by-subnet.sh) — UI 수동 복구용 */
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
    const lockBusy = isRestoreFlockBusyError(combined);
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
      error: mapRestoreExecFailure(combined, stderr, e.message),
    };
  }
}
