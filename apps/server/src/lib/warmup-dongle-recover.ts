import {
  recoverPostingDongleSocksPath,
  type DongleSocksRecoverResult,
} from './dongle-socks-recover.js';

export function isWarmupConnectionError(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return msg.includes('NO_LINKS_FOUND:warmup') && msg.includes('reason=connection');
}

export type WarmupDongleRecoverResult = DongleSocksRecoverResult;

/** post_blog 워밍업·SOCKS 실패 — 공인 IP 재발급 없이 routing·3proxy·일괄 복구 */
export async function recoverPostingDongleAfterWarmupConnection(
  proxyPort: number,
  modemId?: string,
): Promise<WarmupDongleRecoverResult> {
  return recoverPostingDongleSocksPath(proxyPort, modemId);
}
