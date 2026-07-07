import { syncFortune82ProductsCache } from '../modules/narration-script/fortune82-product-cache.js';
import { logOperation } from './log-emitter.js';
import { getKstClock } from './crank-schedule-config.js';

let lastFortune82SyncKey = '';

/** 매일 06:45 KST 포춘82 상품 캐시 동기화 (HUMA_포춘82_연동가이드) */
export function startFortune82ProductSyncScheduler(): void {
  setInterval(() => {
    void tickFortune82ProductSync();
  }, 30_000);
}

async function tickFortune82ProductSync(): Promise<void> {
  const { hour, minute } = getKstClock();
  const key = `${new Date().toISOString().slice(0, 10)}-0645`;
  if (hour !== 6 || minute < 45 || minute > 46 || lastFortune82SyncKey === key) return;
  lastFortune82SyncKey = key;

  const result = await syncFortune82ProductsCache();
  await logOperation({
    level: result.error ? 'warn' : 'info',
    message: `[fortune82-sync] 스케줄 — synced=${result.synced}${result.error ? ` err=${result.error}` : ''}`,
    workspace: 'fortune82',
  });
}
