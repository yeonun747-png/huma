import { syncQuizContentCache } from '../modules/video-content/quiz-content-cache.js';
import { logOperation } from './log-emitter.js';
import { getKstClock } from './crank-schedule-config.js';

let lastQuizSyncKey = '';

/** 매일 06:30 KST 퀴즈 콘텐츠 캐시 동기화 */
export function startQuizContentSyncScheduler(): void {
  setInterval(() => {
    void tickQuizContentSync();
  }, 30_000);
}

async function tickQuizContentSync(): Promise<void> {
  const { hour, minute } = getKstClock();
  const key = `${new Date().toISOString().slice(0, 10)}-0630`;
  if (hour !== 6 || minute < 30 || minute > 31 || lastQuizSyncKey === key) return;
  lastQuizSyncKey = key;

  const result = await syncQuizContentCache();
  await logOperation({
    level: result.error ? 'warn' : 'info',
    message: `[quiz-sync] 스케줄 실행 — synced=${result.synced}${result.error ? ` err=${result.error}` : ''}`,
    workspace: 'quizoasis',
  });
}
