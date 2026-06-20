import { logOperation } from './log-emitter.js';
import { getKstClock } from './crank-schedule-config.js';
import { runVideoContentStorageAutoCleanup } from '../modules/video-content/storage.js';

let lastAutoCleanupKey = '';

/** 매일 04:30 KST — 영상 SSD 자동 정리 (설정 활성 시) */
export function startVideoContentStorageScheduler(): void {
  setInterval(() => {
    void tickVideoContentStorageCleanup();
  }, 60_000);
}

async function tickVideoContentStorageCleanup(): Promise<void> {
  const { hour, minute } = getKstClock();
  const key = `${new Date().toISOString().slice(0, 10)}-0430`;
  if (hour !== 4 || minute !== 30 || lastAutoCleanupKey === key) return;
  lastAutoCleanupKey = key;

  try {
    const result = await runVideoContentStorageAutoCleanup();
    if (result.deletedSources === 0 && result.deletedSubtitled === 0) return;
    await logOperation({
      level: 'info',
      message: `[video-content-storage] 스케줄 정리 — 원본 ${result.deletedSources}, 자막본 ${result.deletedSubtitled}`,
    });
  } catch (err) {
    await logOperation({
      level: 'warn',
      message: `[video-content-storage] 스케줄 정리 실패 — ${(err as Error).message}`,
    });
  }
}
