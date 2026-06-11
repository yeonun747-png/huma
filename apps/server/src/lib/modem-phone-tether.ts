import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readDongleInterfaceFromConf } from './dongle-interfaces.js';
import { proxyPortToSlot } from './modem-ports.js';
import { isPhoneCrankSlot, resolvePhoneSerial } from './phone-crank.js';
import { sleep } from './utils.js';

const ENSURE_TIMEOUT_MS = 90_000;

function ensureTetherScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../scripts/huma-phone-ensure-tether.sh');
}

/** 실폰 슬롯 — iface IPv4·policy route·3proxy bind 동기화 */
export async function ensurePhoneCrankTether(proxyPort: number): Promise<void> {
  if (process.platform === 'win32') return;

  const slot = proxyPortToSlot(proxyPort);
  if (!isPhoneCrankSlot(slot)) return;

  const serial = resolvePhoneSerial(slot);
  const iface = readDongleInterfaceFromConf(slot);
  if (!serial || !iface) {
    throw new Error(`slot${slot} 실폰 serial/iface 없음 — restore-dongle-by-subnet.sh`);
  }

  const scriptPath = ensureTetherScriptPath();
  try {
    const out = execFileSync('sudo', ['-n', 'bash', scriptPath, serial, iface, String(proxyPort)], {
      encoding: 'utf8',
      timeout: ENSURE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    const tail = out.trim().split('\n').pop() ?? '';
    if (tail) console.info(`[phone-tether] ${tail}`);
    if (!tail.startsWith('OK ')) {
      throw new Error(tail || 'phone tether ensure failed');
    }
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    const partial = e.stdout?.trim().split('\n').pop() ?? '';
    throw new Error(partial || e.message || 'phone tether ensure failed');
  }

  await sleep(1500);
}
