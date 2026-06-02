import { existsSync, readFileSync } from 'fs';

const DEFAULT_CONF = '/etc/huma/dongle-slot-interfaces.conf';

/** /etc/huma/dongle-slot-interfaces.conf — `6=eth5` 형식 */
export function readDongleInterfaceFromConf(
  slotNumber: number,
  confPath = process.env.HUMA_DONGLE_INTERFACES_CONF ?? DEFAULT_CONF,
): string | null {
  if (!existsSync(confPath)) return null;
  const text = readFileSync(confPath, 'utf8');
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

/** v3_28 시드값(dongle6) 등 플레이스홀더는 실제 NIC가 아님 */
export function isPlaceholderInterfaceName(name: string | null | undefined): boolean {
  if (!name) return true;
  return /^dongle\d+$/i.test(name);
}
