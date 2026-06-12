import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FCITX_ENV_PATH = join(homedir(), '.huma', 'fcitx-session.env');

export type VncImeMode = 'hangul' | 'english' | 'unknown';

export interface VncImeStatus {
  fcitxRunning: boolean;
  mode: VncImeMode;
  hint: string;
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** start-fcitx-xvfb.sh 가 기록한 DBUS·DISPLAY (Chromium fcitx 연동용) */
export function readFcitxSessionEnv(): Record<string, string> {
  if (!existsSync(FCITX_ENV_PATH)) return {};
  try {
    return parseEnvFile(readFileSync(FCITX_ENV_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function fcitxRemote(args: string[]): Promise<string> {
  const session = readFcitxSessionEnv();
  const env = {
    ...process.env,
    DISPLAY: session.DISPLAY ?? process.env.DISPLAY ?? ':99',
    ...(session.DBUS_SESSION_BUS_ADDRESS?.startsWith('unix:')
      ? { DBUS_SESSION_BUS_ADDRESS: session.DBUS_SESSION_BUS_ADDRESS }
      : {}),
  };
  const { stdout } = await execFileAsync('fcitx-remote', args, {
    timeout: 4000,
    env,
  });
  return stdout.trim();
}

async function isFcitxRunning(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try {
    await execFileAsync('pgrep', ['-x', 'fcitx'], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** fcitx-remote: 0=영문 1=한글 (fcitx-hangul) */
export async function getVncImeStatus(): Promise<VncImeStatus> {
  const fcitxRunning = await isFcitxRunning();
  if (!fcitxRunning) {
    return {
      fcitxRunning: false,
      mode: 'unknown',
      hint: 'fcitx 미실행 — pm2 restart huma-server',
    };
  }
  try {
    const code = await fcitxRemote([]);
    const mode: VncImeMode = code === '1' ? 'hangul' : code === '0' ? 'english' : 'unknown';
    return {
      fcitxRunning: true,
      mode,
      hint:
        mode === 'hangul'
          ? '한글 — VNC HUD 「한/영」 클릭으로 전환'
          : '영문 — VNC HUD 「한/영」 클릭으로 전환',
    };
  } catch {
    return {
      fcitxRunning: true,
      mode: 'unknown',
      hint: 'fcitx 상태 확인 실패',
    };
  }
}

export async function toggleVncIme(): Promise<VncImeStatus> {
  if (!(await isFcitxRunning())) {
    return getVncImeStatus();
  }
  try {
    await fcitxRemote(['-t']);
  } catch {
    /* ignore */
  }
  return getVncImeStatus();
}

export async function setVncImeHangul(): Promise<VncImeStatus> {
  if (!(await isFcitxRunning())) return getVncImeStatus();
  try {
    await fcitxRemote(['-s', 'hangul']);
  } catch {
    /* ignore */
  }
  return getVncImeStatus();
}

export async function setVncImeEnglish(): Promise<VncImeStatus> {
  if (!(await isFcitxRunning())) return getVncImeStatus();
  try {
    await fcitxRemote(['-s', 'keyboard-us']);
  } catch {
    try {
      await fcitxRemote(['-c']);
    } catch {
      /* ignore */
    }
  }
  return getVncImeStatus();
}
