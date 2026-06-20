import { syncPananaCharacters } from '../modules/video-content/panana-characters.js';
import { logOperation } from './log-emitter.js';
import { getKstClock } from './crank-schedule-config.js';

let lastPananaSyncKey = '';

/** 매일 06:00 KST 파나나 캐릭터 캐시 동기화 */
export function startPananaCharacterSyncScheduler(): void {
  setInterval(() => {
    void tickPananaCharacterSync();
  }, 30_000);
}

async function tickPananaCharacterSync(): Promise<void> {
  const { hour, minute } = getKstClock();
  const key = `${new Date().toISOString().slice(0, 10)}-06`;
  if (hour !== 6 || minute > 1 || lastPananaSyncKey === key) return;
  lastPananaSyncKey = key;

  const result = await syncPananaCharacters();
  await logOperation({
    level: result.error ? 'warn' : 'info',
    message: `[panana-sync] 스케줄 실행 — synced=${result.synced}${result.error ? ` err=${result.error}` : ''}`,
    workspace: 'panana',
  });
}
