import { existsSync, readFileSync } from 'fs';
import { CRANK_PROXY_PORTS } from './modem-ports.js';

const PHONE_SERIAL_CONF = process.env.HUMA_PHONE_CRANK_CONF ?? '/etc/huma/phone-crank-slots.conf';
const PHONE_SERIAL_CACHE = '/etc/huma/phone-crank-serials.cache';

export const PHONE_CRANK_SLOTS = [6, 7] as const;

export function isPhoneCrankSlot(slotNumber: number): boolean {
  return (PHONE_CRANK_SLOTS as readonly number[]).includes(slotNumber);
}

export function isPhoneCrankProxyPort(proxyPort: number): boolean {
  return (CRANK_PROXY_PORTS as readonly number[]).includes(proxyPort);
}

function readKeyFromConf(path: string, slotNumber: number): string | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const slot = Number(trimmed.slice(0, eq).trim());
    if (slot === slotNumber) return trimmed.slice(eq + 1).trim();
  }
  return null;
}

/** /etc/huma/phone-crank-slots.conf — `6=RF9R...` */
export function readPhoneSerialFromConf(slotNumber: number): string | null {
  return readKeyFromConf(PHONE_SERIAL_CONF, slotNumber);
}

/** restore-phone-crank.sh 가 갱신한 런타임 serial (conf 없을 때 자동탐색 결과) */
export function readPhoneSerialCached(slotNumber: number): string | null {
  return readKeyFromConf(PHONE_SERIAL_CACHE, slotNumber);
}

export function resolvePhoneSerial(slotNumber: number): string | null {
  return readPhoneSerialFromConf(slotNumber) ?? readPhoneSerialCached(slotNumber);
}
