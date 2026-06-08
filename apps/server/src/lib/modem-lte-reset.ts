import { execFileSync } from 'child_process';
import { accessSync, constants } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sleep } from './utils.js';
import { getCachedAtPort, parseAtPortFromLteResetLog } from './dongle-at-cache.js';

function resolveIpBin(): string {
  for (const candidate of ['/usr/sbin/ip', '/sbin/ip']) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return 'ip';
}

const IP_BIN = resolveIpBin();
const LTE_RESET_TIMEOUT_MS = 150_000;

function lteResetScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../scripts/huma-modem-lte-reset.sh');
}

async function longLinkDisconnect(iface: string): Promise<void> {
  const downSec = Number(process.env.HUMA_MODEM_LINK_DOWN_SEC ?? 35);
  const upSec = Number(process.env.HUMA_MODEM_LINK_UP_SETTLE_SEC ?? 15);
  execFileSync('sudo', ['-n', IP_BIN, 'link', 'set', iface, 'down'], { stdio: 'pipe' });
  await sleep(downSec * 1000);
  execFileSync('sudo', ['-n', IP_BIN, 'link', 'set', iface, 'up'], { stdio: 'pipe' });
  await sleep(upSec * 1000);
}

export type LteResetResult = {
  logLine: string;
  atPort?: string;
};

/**
 * LTE 공인 IP 변경 — tier별 에스컬레이션 (1:빠른 AT → 3:강한 reset).
 * sudoers: setup-huma-modem-sudoers.sh
 */
export async function resetLteModem(
  iface: string,
  proxyPort?: number,
  tier = 1,
  slotNumber?: number,
): Promise<LteResetResult> {
  if (process.platform === 'win32') return { logLine: 'win32 skip' };

  const scriptPath = lteResetScriptPath();
  const args = ['-n', 'bash', scriptPath, iface];
  if (proxyPort) args.push(String(proxyPort));
  args.push(String(Math.min(3, Math.max(1, tier))));

  const cachedAt = slotNumber ? await getCachedAtPort(slotNumber) : undefined;
  const env = {
    ...process.env,
    ...(cachedAt ? { HUMA_DONGLE_AT_PORT: cachedAt } : {}),
  };

  try {
    const out = execFileSync('sudo', args, {
      encoding: 'utf8',
      timeout: LTE_RESET_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
      env,
    });
    const tail = out.trim().split('\n').pop() ?? '';
    if (tail) console.info(`[lte-reset] ${tail}`);
    return { logLine: tail, atPort: parseAtPortFromLteResetLog(tail) };
  } catch (err) {
    const e = err as { stdout?: string };
    const partial = e.stdout?.trim().split('\n').pop() ?? '';
    if (partial) console.warn(`[lte-reset] partial: ${partial}`);
    await longLinkDisconnect(iface);
    return { logLine: partial || 'fallback link disconnect', atPort: parseAtPortFromLteResetLog(partial) };
  }
}
