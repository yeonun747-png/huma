import { supabase } from '../../middleware/auth.js';
import { CRANK_SCHEDULED_LOCK_TTL_SEC } from '../../lib/modem-ports.js';
import { recordCrankSessionOnModem } from '../../lib/crank-modems.js';
import { acquireModem, releaseModem, type ModemSession } from '../proxy/manager.js';
import { runSocialCrank } from '../playwright/naver/social.js';

export interface ScheduledCrankPayload {
  ourBlogUrls: string[];
  scheduledCrank?: boolean;
  sessionMinutes?: number;
}

/** 스케줄 세션: 모뎀 할당 → (계정 전환 시에만 IP 1회 교체) → crank → last_crank_at·데이터 누적 */
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
