import axios from 'axios';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import {
  getHumanEngineScheduleConfig,
  getWatcherSettings,
  resolveRecoveryDelayMs,
  shouldNotifySlack,
} from '../../lib/human-engine-policy.js';
import { reconnectModem } from '../modem/reconnect.js';
import type { ModemSession } from '../proxy/manager.js';
import { getModemIdByProxyPort } from '../proxy/manager.js';

const recoveryTimers = new Map<string, NodeJS.Timeout[]>();

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

async function postSlack(text: string) {
  if (!(await shouldNotifySlack())) return;
  const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!webhook) return;
  await axios.post(webhook, { text }).catch(() => {});
}

export async function pauseAccount(accountId: string) {
  await supabase.from('huma_accounts').update({ is_active: false }).eq('id', accountId);
}

async function resumeAccount(accountId: string) {
  const { data } = await supabase
    .from('huma_accounts')
    .select('layer4_rest_until, is_active')
    .eq('id', accountId)
    .single();

  if (data?.layer4_rest_until && new Date(data.layer4_rest_until) > new Date()) {
    return;
  }

  await supabase.from('huma_accounts').update({ is_active: true }).eq('id', accountId);
}

function clearRecoveryTimers(accountId: string) {
  const existing = recoveryTimers.get(accountId) ?? [];
  existing.forEach(clearTimeout);
  recoveryTimers.delete(accountId);
}

export function scheduleRecovery(accountId: string, delayMs: number) {
  clearRecoveryTimers(accountId);
  if (delayMs <= 0) {
    void resumeAccount(accountId);
    return;
  }
  const t = setTimeout(async () => {
    await resumeAccount(accountId);
    await logOperation({
      level: 'info',
      message: `Layer4 복구 완료 (${Math.round(delayMs / 60000)}분 대기)`,
      account_id: accountId,
    });
    recoveryTimers.delete(accountId);
  }, delayMs);
  recoveryTimers.set(accountId, [t]);
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
    await postSlack(`⚠️ 429 탐지 — 모뎀 ID 없음\n계정: ${accountId}\n수동 IP 재발급 필요`);
    return;
  }

  try {
    const result = await reconnectModem(modemId);
    if (!result.success) {
      await postSlack(
        `🚨 429 후 IP 재발급 실패\n계정: ${accountId}\n슬롯: ${result.slotNumber ?? '?'}\nold: ${result.oldIp ?? '?'} new: ${result.newIp ?? '?'}\n수동 대응 필요`,
      );
    }
  } catch (err) {
    await postSlack(
      `🚨 429 모뎀 재연결 오류\n계정: ${accountId}\n${(err as Error).message}\n수동 대응 필요`,
    );
  }
}

export async function handleLayer4Detection(
  accountId: string,
  err: unknown,
  session?: ModemSession,
) {
  const watcher = await getWatcherSettings();
  const human = await getHumanEngineScheduleConfig();
  const { countToday, tier } = await bumpDetectionState(accountId);

  const autoPause =
    watcher.auto_pause !== false && human.fingerprint?.auto_pause_on_detect !== false;
  if (autoPause) {
    await pauseAccount(accountId);
  }

  if (countToday >= 3) {
    await setWeekRest(accountId);
    clearRecoveryTimers(accountId);
    await postSlack(
      `🛑 Layer4 수동 점검 — 1주 휴식\n계정: ${accountId}\n오늘 탐지: ${countToday}회\nlayer4_rest_until: 7일`,
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

  if (tier >= 3) {
    const { data } = await supabase.from('huma_accounts').select('health_score').eq('id', accountId).single();
    const health = Math.max(0, (data?.health_score ?? 100) - 15);
    await supabase.from('huma_accounts').update({ health_score: health }).eq('id', accountId);
    scheduleRecovery(accountId, delayMs);
    await postSlack(
      `🚨 Layer4 3차 연속 탐지\n계정: ${accountId}\nhealth→${health}\n${Math.round(delayMs / 60000)}분 후 재개`,
    );
  } else if (is429 || tier >= 2) {
    await handle429Reconnect(accountId, session);
    scheduleRecovery(accountId, delayMs);
    await postSlack(
      `⚠️ Layer4 2차 (429/재CAPTCHA)\n계정: ${accountId}\n티어: ${tier}\n${Math.round(delayMs / 60000)}분 후 자동 재개`,
    );
  } else if (captcha || isBlockError(err)) {
    scheduleRecovery(accountId, delayMs);
    await postSlack(
      `⚠️ Layer4 1차 CAPTCHA\n계정: ${accountId}\n${Math.round(delayMs / 60000)}분 후 자동 재개`,
    );
  } else {
    scheduleRecovery(accountId, delayMs);
    await postSlack(`⚠️ Layer4 탐지\n계정: ${accountId}\n${Math.round(delayMs / 60000)}분 후 자동 재개`);
  }

  await logOperation({
    level: 'ERROR',
    message: `Layer4 탐지 → 자동 중지 (tier ${tier}, today ${countToday})`,
    account_id: accountId,
  });
}

export async function notifySlack(message: string) {
  await postSlack(message);
}
