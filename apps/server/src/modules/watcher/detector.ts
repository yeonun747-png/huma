import axios from 'axios';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { getSetting } from '../../lib/settings.js';
import { sleep } from '../../lib/utils.js';

const recoveryTimers = new Map<string, NodeJS.Timeout[]>();

export function isCaptchaError(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return msg.includes('CAPTCHA') || msg.includes('captcha');
}

export function isBlockError(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return msg.includes('429') || msg.includes('BLOCK') || msg.includes('Layer4');
}

export async function pauseAccount(accountId: string) {
  await supabase.from('huma_accounts').update({ is_active: false }).eq('id', accountId);
}

export async function handleLayer4Detection(accountId: string) {
  await pauseAccount(accountId);
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook) {
    await axios.post(webhook, {
      text: `🚨 Layer4 감지\n계정: ${accountId}\n시각: ${new Date().toLocaleString('ko-KR')}`,
    });
  }
  scheduleRecovery(accountId, [12 * 60000, 30 * 60000, 120 * 60000]);
  await logOperation({ level: 'ERROR', message: 'Layer4 감지 → 자동 중지', account_id: accountId });
}

export function scheduleRecovery(accountId: string, stepsMs: number[]) {
  const existing = recoveryTimers.get(accountId) ?? [];
  existing.forEach(clearTimeout);
  const timers: NodeJS.Timeout[] = [];

  stepsMs.forEach((ms, i) => {
    const t = setTimeout(async () => {
      await logOperation({
        level: 'info',
        message: `복구 시도 ${i + 1}/${stepsMs.length}`,
        account_id: accountId,
      });
      if (i === stepsMs.length - 1) {
        await supabase.from('huma_accounts').update({ is_active: true }).eq('id', accountId);
      }
    }, ms);
    timers.push(t);
  });

  recoveryTimers.set(accountId, timers);
}

export async function notifySlack(message: string) {
  const config = await getSetting('watcher', { slack_webhook: '' });
  const url = process.env.SLACK_WEBHOOK_URL || config.slack_webhook;
  if (url) await axios.post(url, { text: message });
}
