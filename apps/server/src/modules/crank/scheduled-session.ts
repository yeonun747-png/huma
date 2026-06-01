import { supabase } from '../../middleware/auth.js';
import { RECONNECT_WAIT_MS } from '../../lib/crank-schedule-config.js';
import { CRANK_SCHEDULED_LOCK_TTL_SEC } from '../../lib/modem-ports.js';
import { recordCrankSessionOnModem } from '../../lib/crank-modems.js';
import { sleep } from '../../lib/utils.js';
import { reconnectModem } from '../modem/reconnect.js';
import { acquireModem, releaseModem, type ModemSession } from '../proxy/manager.js';
import { runSocialCrank } from '../playwright/naver/social.js';

export interface ScheduledCrankPayload {
  ourBlogUrls: string[];
  scheduledCrank?: boolean;
  sessionMinutes?: number;
}

/** 스케줄 세션: 모뎀 할당 → reconnect 10분 → crank → last_crank_at·데이터 누적 */
export async function executeScheduledSocialCrank(
  accountId: string,
  payload: ScheduledCrankPayload,
): Promise<void> {
  let modemSession: ModemSession | undefined;

  try {
    modemSession = await acquireModem(accountId, {
      lockTtlSec: CRANK_SCHEDULED_LOCK_TTL_SEC,
    });
    if (!modemSession) throw new Error('NO_MODEM');

    if (modemSession.modemId) {
      await reconnectModem(modemSession.modemId);
      await sleep(RECONNECT_WAIT_MS);
    }

    await runSocialCrank(accountId, { ourBlogUrls: payload.ourBlogUrls ?? [] }, {
      modemSession,
      skipModemAcquire: true,
    });

    const now = new Date().toISOString();
    await supabase
      .from('huma_accounts')
      .update({ last_crank_at: now })
      .eq('id', accountId);

    await recordCrankSessionOnModem(modemSession.proxyPort);
  } finally {
    if (modemSession) await releaseModem(modemSession);
  }
}
