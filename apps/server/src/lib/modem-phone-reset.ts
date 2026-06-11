import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sleep } from './utils.js';

const PHONE_RESET_TIMEOUT_MS = 120_000;

function phoneResetScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../scripts/huma-phone-airplane-reset.sh');
}

export type PhoneResetResult = {
  logLine: string;
};

/**
 * C-Rank 직결 실폰 — ADB 비행기모드 IP 교체.
 * sudoers: setup-huma-modem-sudoers.sh
 */
export async function resetPhoneCrank(
  serial: string,
  iface: string,
  proxyPort?: number,
): Promise<PhoneResetResult> {
  if (process.platform === 'win32') {
    await sleep(3000);
    return { logLine: 'win32 skip' };
  }

  const scriptPath = phoneResetScriptPath();
  const args = ['-n', 'bash', scriptPath, serial, iface];
  if (proxyPort) args.push(String(proxyPort));

  try {
    const out = execFileSync('sudo', args, {
      encoding: 'utf8',
      timeout: PHONE_RESET_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    });
    const tail = out.trim().split('\n').pop() ?? '';
    if (tail) console.info(`[phone-reset] ${tail}`);
    if (!tail.startsWith('OK ')) {
      throw new Error(tail || 'phone airplane reset failed');
    }
    return { logLine: tail };
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    const partial = e.stdout?.trim().split('\n').pop() ?? '';
    throw new Error(partial || e.message || 'phone airplane reset failed');
  }
}
