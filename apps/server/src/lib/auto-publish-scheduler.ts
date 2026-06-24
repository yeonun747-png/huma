import { formatKstDateKey } from './posting-daily-target.js';
import { getKstClock } from './crank-schedule-config.js';
import { getSystemPaused } from './system-pause.js';
import { rolloverAutoPublishDay, triggerDueAutoPublishJobs } from './auto-publish-state.js';
import { logOperation } from './log-emitter.js';

let lastAutoPublishDayKey = '';
let lastAutoPublishTickAt = 0;

async function tickAutoPublishScheduler(): Promise<void> {
  if (getSystemPaused()) return;

  const { hour, minute } = getKstClock();
  const dayKey = formatKstDateKey();

  if (hour === 0 && minute === 1 && lastAutoPublishDayKey !== dayKey) {
    lastAutoPublishDayKey = dayKey;
    await rolloverAutoPublishDay(dayKey).catch((err) =>
      console.error('[auto-publish-scheduler] day rollover:', err),
    );
  }

  const now = Date.now();
  if (now - lastAutoPublishTickAt < 20_000) return;
  lastAutoPublishTickAt = now;

  const triggered = await triggerDueAutoPublishJobs();
  if (triggered > 0) {
    await logOperation({
      level: 'info',
      message: `[auto-publish-scheduler] content_full ${triggered}건 등록`,
    });
  }
}

export function startAutoPublishScheduler(): void {
  setInterval(() => {
    tickAutoPublishScheduler().catch((err) =>
      console.error('[auto-publish-scheduler] tick:', err),
    );
  }, 30_000);
  tickAutoPublishScheduler().catch((err) =>
    console.error('[auto-publish-scheduler] startup:', err),
  );
}
