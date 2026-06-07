import axios from 'axios';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import {
  getHumanEngineScheduleConfig,
  getWatcherSettings,
  resolveRecoveryDelayMs,
  shouldNotifySlack,
} from '../../lib/human-engine-policy.js';
import { notifyTelegram } from './telegram.js';
import { reconnectModem } from '../modem/reconnect.js';
import type { ModemSession } from '../proxy/manager.js';
import { getModemIdByProxyPort } from '../proxy/manager.js';

export function isCaptchaError(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return msg.includes('CAPTCHA') || msg.includes('captcha');
}

export function is429Error(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return msg.includes('429') || msg.toLowerCase().includes('too many requests');
}

export function isBlockError(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return is429Error(err) || msg.includes('BLOCK') || msg.includes('Layer4');
}

function kstDateKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function postWatcherAlert(text: string, workspace?: string | null) {
  if (await shouldNotifySlack()) {
    const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
    if (webhook) await axios.post(webhook, { text }).catch(() => {});
  }
  await notifyTelegram(text, workspace);
}

export async function pauseAccount(accountId: string) {
  await supabase.from('huma_accounts').update({ is_active: false }).eq('id', accountId);
}

async function setTimedRest(accountId: string, delayMs: number): Promise<number> {
  const ms = Math.max(delayMs, 15 * 60_000);
  const until = new Date(Date.now() + ms);
  await supabase
    .from('huma_accounts')
    .update({
      is_active: false,
      layer4_rest_until: until.toISOString(),
    })
    .eq('id', accountId);
  return ms;
}

async function setWeekRest(accountId: string) {
  const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await supabase
    .from('huma_accounts')
    .update({
      is_active: false,
      layer4_rest_until: until.toISOString(),
    })
    .eq('id', accountId);
}

function captchaRestMs(): number {
  const hours = Number(process.env.HUMA_LAYER4_CAPTCHA_REST_HOURS);
  const resolved = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return resolved * 3600_000;
}

async function setCaptchaRest(accountId: string): Promise<number> {
  const ms = captchaRestMs();
  const until = new Date(Date.now() + ms);
  await supabase
    .from('huma_accounts')
    .update({
      is_active: false,
      layer4_rest_until: until.toISOString(),
    })
    .eq('id', accountId);
  return ms;
}

async function bumpDetectionState(accountId: string): Promise<{
  countToday: number;
  tier: number;
}> {
  const today = kstDateKey();
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('layer4_detection_count_today, layer4_recovery_tier, layer4_last_detection_at')
    .eq('id', accountId)
    .single();

  const lastAt = account?.layer4_last_detection_at
    ? new Date(account.layer4_last_detection_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    : null;

  let countToday = account?.layer4_detection_count_today ?? 0;
  let tier = account?.layer4_recovery_tier ?? 0;

  if (lastAt !== today) {
    countToday = 0;
    tier = 0;
  }

  countToday += 1;
  tier += 1;

  await supabase
    .from('huma_accounts')
    .update({
      layer4_detection_count_today: countToday,
      layer4_recovery_tier: tier,
      layer4_last_detection_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  return { countToday, tier };
}

async function resolveModemId(session?: ModemSession, proxyPort?: number): Promise<string | null> {
  if (session?.modemId) return session.modemId;
  if (proxyPort) return getModemIdByProxyPort(proxyPort);
  return null;
}

async function handle429Reconnect(accountId: string, session?: ModemSession) {
  const modemId = await resolveModemId(session, session?.proxyPort);
  if (!modemId) {
    await postWatcherAlert(`⚠️ 429 탐지 — 모뎀 ID 없음\n계정: ${accountId}\n수동 IP 재발급 필요`);
    return;
  }

  try {
    const result = await reconnectModem(modemId);
    if (!result.success) {
      await postWatcherAlert(
        `🚨 429 후 IP 재발급 실패\n계정: ${accountId}\n슬롯: ${result.slotNumber ?? '?'}\nold: ${result.oldIp ?? '?'} new: ${result.newIp ?? '?'}\n수동 대응 필요`,
      );
    }
  } catch (err) {
    await postWatcherAlert(
      `🚨 429 모뎀 재연결 오류\n계정: ${accountId}\n${(err as Error).message}\n수동 대응 필요`,
    );
  }
}

export async function handleLayer4Detection(
  accountId: string,
  err: unknown,
  session?: ModemSession,
  options?: { skipExternalNotify?: boolean; workspace?: string | null },
) {
  const watcher = await getWatcherSettings();
  const human = await getHumanEngineScheduleConfig();
  const { countToday, tier } = await bumpDetectionState(accountId);

  const autoPause =
    watcher.auto_pause !== false && human.fingerprint?.auto_pause_on_detect !== false;
  if (autoPause) {
    await pauseAccount(accountId);
  }

  const notify = (text: string) => {
    if (options?.skipExternalNotify) return;
    return postWatcherAlert(text, options?.workspace);
  };

  if (countToday >= 3) {
    await setWeekRest(accountId);
    await notify(
      `🛑 Layer4 수동 점검 — 1주 휴식\n계정: ${accountId}\n오늘 탐지: ${countToday}회\nlayer4_rest_until: 7일 (is_active 수동 후 재투입)`,
    );
    await logOperation({
      level: 'ERROR',
      message: `Layer4 3+/일 → 1주 휴식`,
      account_id: accountId,
    });
    return;
  }

  const captcha = isCaptchaError(err);
  const is429 = is429Error(err);
  const delayMs = resolveRecoveryDelayMs(tier, is429, watcher, human);
  const restLabel = (ms: number) =>
    `${Math.round(ms / 60000)}분 휴식 (계정 관리에서 is_active 수동 후 재투입)`;

  if (tier >= 3) {
    const { data } = await supabase.from('huma_accounts').select('health_score').eq('id', accountId).single();
    const health = Math.max(0, (data?.health_score ?? 100) - 15);
    await supabase.from('huma_accounts').update({ health_score: health }).eq('id', accountId);
    const restMs = await setTimedRest(accountId, delayMs);
    await notify(
      `🚨 Layer4 3차 연속 탐지\n계정: ${accountId}\nhealth→${health}\n${restLabel(restMs)}`,
    );
  } else if (is429 || tier >= 2) {
    await handle429Reconnect(accountId, session);
    const restMs = await setTimedRest(accountId, delayMs);
    await notify(
      `⚠️ Layer4 2차 (429/재CAPTCHA)\n계정: ${accountId}\n티어: ${tier}\n${restLabel(restMs)}`,
    );
  } else if (captcha || isBlockError(err)) {
    if (tier === 1 && captcha) {
      const restMs = await setCaptchaRest(accountId);
      const restHours = Math.round(restMs / 3600000);
      await notify(
        `⚠️ Layer4 1차 CAPTCHA — ${restHours}시간 휴식 (계정 관리에서 is_active 수동 후 재투입)\n계정: ${accountId}`,
      );
    } else {
      const restMs = await setTimedRest(accountId, delayMs);
      await notify(`⚠️ Layer4 1차 CAPTCHA\n계정: ${accountId}\n${restLabel(restMs)}`);
    }
  } else {
    const restMs = await setTimedRest(accountId, delayMs);
    await notify(`⚠️ Layer4 탐지\n계정: ${accountId}\n${restLabel(restMs)}`);
  }

  await logOperation({
    level: 'ERROR',
    message: `Layer4 탐지 → 자동 중지 (tier ${tier}, today ${countToday})`,
    account_id: accountId,
  });
}

export async function notifySlack(message: string, workspace?: string | null) {
  await postWatcherAlert(message, workspace);
}
