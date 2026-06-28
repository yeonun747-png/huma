import { formatKstDateKey } from './posting-daily-target.js';
import { reconcileAllPostingWarmupDays } from './posting-warmup-day.js';
import { getKstClock } from './crank-schedule-config.js';
import { getSystemPaused } from './system-pause.js';
import { rolloverAutoPublishDay, triggerDueAutoPublishJobs } from './auto-publish-state.js';
import { runDonglePreSlotHealthChecks } from './dongle-pre-slot-health.js';
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
    await reconcileAllPostingWarmupDays().catch((err) =>
      console.error('[auto-publish-scheduler] warmup reconcile after rollover:', err),
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

  const dongleRecovered = await runDonglePreSlotHealthChecks();
  if (dongleRecovered > 0) {
    await logOperation({
      level: 'info',
      message: `[auto-publish-scheduler] 다음 큐 10분 전 동글 사전 복구 ${dongleRecovered}건`,
    });
  }
}

export function startAutoPublishScheduler(): void {
  reconcileAllPostingWarmupDays().catch((err) =>
    console.error('[auto-publish-scheduler] warmup reconcile on start:', err),
  );
  setInterval(() => {
    tickAutoPublishScheduler().catch((err) =>
      console.error('[auto-publish-scheduler] tick:', err),
    );
  }, 30_000);
  tickAutoPublishScheduler().catch((err) =>
    console.error('[auto-publish-scheduler] startup:', err),
  );
}
