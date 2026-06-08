import { execFileSync } from 'child_process';
import { accessSync, constants } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sleep } from './utils.js';

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

/**
 * LTE 공인 IP 변경 — AT+CFUN(비행기모드) 우선, 실패 시 장시간 link down/up.
 * sudoers: NOPASSWD ip + huma-modem-lte-reset.sh (setup-huma-modem-sudoers.sh)
 */
export async function resetLteModem(iface: string): Promise<void> {
  if (process.platform === 'win32') return;

  const scriptPath = lteResetScriptPath();
  try {
    execFileSync('sudo', ['-n', 'bash', scriptPath, iface], {
      stdio: 'pipe',
      timeout: LTE_RESET_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    });
    return;
  } catch {
    await longLinkDisconnect(iface);
  }
}
