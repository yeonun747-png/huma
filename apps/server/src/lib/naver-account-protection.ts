import type { BrowserContext, Page } from 'playwright';
import axios from 'axios';

import { supabase } from '../middleware/auth.js';
import { disableAutoPublish } from './auto-publish-state.js';
import { logOperation } from './log-emitter.js';
import { shouldNotifySlack } from './human-engine-policy.js';
import { notifyLayer4Telegram } from '../modules/watcher/telegram.js';
import { closeBrowserContext } from '../modules/playwright/browser.js';
import { forceReleaseModemForAccount } from '../modules/proxy/manager.js';
import { forceReleaseAccount } from './account-lock.js';
import { deleteJobsByIds } from './delete-job.js';
import { resetPostingQuotaReservation } from './posting-quota-reserve.js';
import { cancelCaptchaHold } from '../modules/watcher/captcha-hold.js';

export const NAVER_ACCOUNT_PROTECTED = 'NAVER_ACCOUNT_PROTECTED';

export type NaverAccountProtectionPhase = 'login' | 'captcha' | 'posting';

const PHASE_LABEL: Record<NaverAccountProtectionPhase, string> = {
  login: '로그인 직후',
  captcha: 'CAPTCHA 해결 직후',
  posting: '포스팅 직후',
};

const PROTECTION_BODY_PATTERNS = [
  /아이디를\s*보호하고\s*있습니다/,
  /보호조치\s*해제/,
];

export function urlIndicatesNaverAccountProtection(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('idsafetyrelease') ||
    lower.includes('viewidsafetyinfo') ||
    lower.includes('/help/idsafety')
  );
}

export function bodyIndicatesNaverAccountProtection(body: string): boolean {
  return PROTECTION_BODY_PATTERNS.some((re) => re.test(body));
}

export async function isNaverAccountProtectionPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (!url.includes('naver.com')) return false;
  if (urlIndicatesNaverAccountProtection(url)) return true;

  const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  return bodyIndicatesNaverAccountProtection(body);
}

export async function findNaverAccountProtectionPage(
  context: BrowserContext,
): Promise<Page | null> {
  for (const page of context.pages()) {
    if (await isNaverAccountProtectionPage(page)) return page;
  }
  return null;
}

export function naverAccountProtectedError(phase: NaverAccountProtectionPhase): Error {
  return new Error(`${NAVER_ACCOUNT_PROTECTED}:${phase}`);
}

export function isNaverAccountProtectionError(err: unknown): boolean {
  return ((err as Error)?.message ?? '').includes(NAVER_ACCOUNT_PROTECTED);
}

export function parseNaverAccountProtectionPhase(err: unknown): NaverAccountProtectionPhase {
  const msg = (err as Error)?.message ?? '';
  if (msg.includes(':captcha')) return 'captcha';
  if (msg.includes(':posting')) return 'posting';
  return 'login';
}

export async function throwIfNaverAccountProtection(
  page: Page,
  phase: NaverAccountProtectionPhase,
): Promise<void> {
  if (!(await isNaverAccountProtectionPage(page))) return;
  await closeBrowserContext(page.context()).catch(() => {});
  throw naverAccountProtectedError(phase);
}

export async function throwIfNaverAccountProtectionInContext(
  context: BrowserContext,
  phase: NaverAccountProtectionPhase,
): Promise<void> {
  const hit = await findNaverAccountProtectionPage(context);
  if (!hit) return;
  await closeBrowserContext(context).catch(() => {});
  throw naverAccountProtectedError(phase);
}

/** 아이디 보호조치 — 큐 삭제 · 동글·계정 락 해제 · 자동발행 OFF · is_active OFF */
async function purgeAccountPostingQueue(accountId: string): Promise<number> {
  const { data: rows } = await supabase
    .from('huma_jobs')
    .select('id, status')
    .eq('account_id', accountId)
    .in('job_type', ['content_full', 'post_blog'])
    .in('status', ['pending', 'scheduled', 'running', 'awaiting_captcha']);

  const ids = (rows ?? []).map((r) => r.id as string);
  if (!ids.length) return 0;

  for (const row of rows ?? []) {
    if (row.status === 'awaiting_captcha') {
      await cancelCaptchaHold(row.id as string).catch(() => {});
    }
  }

  const { deleted } = await deleteJobsByIds(ids);
  return deleted;
}

/** 아이디 보호조치 — 자동발행 OFF · is_active OFF · 오퍼레이션 로그 · Telegram */
export async function handleNaverAccountProtection(params: {
  accountId: string;
  workspace?: string | null;
  phase: NaverAccountProtectionPhase;
  humaJobId?: string;
}): Promise<void> {
  const { accountId, phase, humaJobId } = params;

  const { data: acc } = await supabase
    .from('huma_accounts')
    .select('workspace, account_type, naver_id, slot_label, name, is_active, auto_publish_enabled')
    .eq('id', accountId)
    .maybeSingle();

  if (!acc) return;

  const workspace = params.workspace ?? (acc.workspace as string | null) ?? null;
  const label = (acc.slot_label as string | null) ?? (acc.name as string | null) ?? accountId;
  const naverId = (acc.naver_id as string | null) ?? '?';
  const wasActive = acc.is_active !== false;

  if (acc.account_type === 'posting' && workspace) {
    await disableAutoPublish(workspace, accountId).catch((err) => {
      console.error('[naver] disableAutoPublish on protection:', (err as Error).message);
    });
  } else {
    if (acc.auto_publish_enabled) {
      await supabase.from('huma_accounts').update({ auto_publish_enabled: false }).eq('id', accountId);
    }
    await resetPostingQuotaReservation(accountId).catch(() => {});
  }

  const purgedJobs = await purgeAccountPostingQueue(accountId);

  await forceReleaseModemForAccount(accountId).catch((err) => {
    console.error('[naver] forceReleaseModem on protection:', (err as Error).message);
  });
  await forceReleaseAccount(accountId).catch(() => {});

  await supabase.from('huma_accounts').update({ is_active: false }).eq('id', accountId);

  const phaseKo = PHASE_LABEL[phase];
  const logMessage =
    `[naver] 아이디 보호조치 (${phaseKo}) — 큐 ${purgedJobs}건 삭제 · 동글·계정 락 해제 · ` +
    `자동발행 OFF · 계정 사용 중지 (${label}/${naverId})`;

  await logOperation({
    level: 'ERROR',
    message: logMessage,
    account_id: accountId,
    job_id: humaJobId,
    workspace: workspace ?? undefined,
  });

  if (!wasActive) return;

  const telegramText = [
    '🛑 네이버 아이디 보호조치',
    `계정: ${label} (${naverId})`,
    `감지: ${phaseKo}`,
    `조치: 큐 ${purgedJobs}건 삭제 · 동글·계정 락 해제 · 자동발행 OFF · is_active OFF`,
    'VNC에서 「보호조치 해제」 후 계정관리에서 수동 재투입',
  ].join('\n');

  if (await shouldNotifySlack()) {
    const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
    if (webhook) await axios.post(webhook, { text: telegramText }).catch(() => {});
  }
  await notifyLayer4Telegram(telegramText, workspace);
}

export type NaverAuthChallengeKind = '2fa' | 'device';

/** 2FA·기기(새 환경) 인증 요구 — VNC 사람 대기 없이 자동 중단할 대상 */
export function isNaverAuthChallengeError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  return msg.includes('NAVER_LOGIN_2FA') || msg.includes('NAVER_LOGIN_DEVICE_VERIFY');
}

export function parseNaverAuthChallengeKind(err: unknown): NaverAuthChallengeKind {
  const msg = (err as Error)?.message ?? '';
  return msg.includes('NAVER_LOGIN_DEVICE_VERIFY') ? 'device' : '2fa';
}

/**
 * 2FA·기기인증 요구 감지 — 보호조치와 동일 수준으로 정리한다:
 * 큐 삭제 · 동글·계정 락 해제 · 자동발행 OFF · 계정 사용중지(is_active) · Operation 로그(ERROR=우상단 알림) · Slack/Telegram.
 * 브라우저 종료는 호출부(worker finally / continue finally / cancelCaptchaHold)가 담당한다.
 */
export async function handleNaverAuthChallenge(params: {
  accountId: string;
  workspace?: string | null;
  humaJobId?: string;
  kind: NaverAuthChallengeKind;
}): Promise<void> {
  const { accountId, humaJobId, kind } = params;

  const { data: acc } = await supabase
    .from('huma_accounts')
    .select('workspace, account_type, naver_id, slot_label, name, is_active, auto_publish_enabled')
    .eq('id', accountId)
    .maybeSingle();
  if (!acc) return;

  const workspace = params.workspace ?? (acc.workspace as string | null) ?? null;
  const label = (acc.slot_label as string | null) ?? (acc.name as string | null) ?? accountId;
  const naverId = (acc.naver_id as string | null) ?? '?';
  const wasActive = acc.is_active !== false;

  if (acc.account_type === 'posting' && workspace) {
    await disableAutoPublish(workspace, accountId).catch((err) => {
      console.error('[naver] disableAutoPublish on auth-challenge:', (err as Error).message);
    });
  } else {
    if (acc.auto_publish_enabled) {
      await supabase.from('huma_accounts').update({ auto_publish_enabled: false }).eq('id', accountId);
    }
    await resetPostingQuotaReservation(accountId).catch(() => {});
  }

  const purgedJobs = await purgeAccountPostingQueue(accountId);

  await forceReleaseModemForAccount(accountId).catch((err) => {
    console.error('[naver] forceReleaseModem on auth-challenge:', (err as Error).message);
  });
  await forceReleaseAccount(accountId).catch(() => {});

  await supabase.from('huma_accounts').update({ is_active: false }).eq('id', accountId);

  const kindKo = kind === 'device' ? '기기(새 환경) 인증' : '2단계 인증(2FA)';
  const logMessage =
    `[naver] ${kindKo} 요구 감지 — 큐 ${purgedJobs}건 삭제 · 동글·계정 락 해제 · ` +
    `자동발행 OFF · 계정 사용중지 (${label}/${naverId}). VNC에서 인증 완료 후 계정관리에서 재투입`;

  await logOperation({
    level: 'ERROR',
    message: logMessage,
    account_id: accountId,
    job_id: humaJobId,
    workspace: workspace ?? undefined,
  });

  if (!wasActive) return;

  const notifyText = [
    kind === 'device' ? '🔐 네이버 기기(새 환경) 인증 요구' : '🔐 네이버 2단계 인증(2FA) 요구',
    `계정: ${label} (${naverId})`,
    `조치: 큐 ${purgedJobs}건 삭제 · 동글·계정 락 해제 · 자동발행 OFF · is_active OFF`,
    'VNC에서 인증 완료 후 계정관리에서 수동 재투입',
  ].join('\n');

  if (await shouldNotifySlack()) {
    const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
    if (webhook) await axios.post(webhook, { text: notifyText }).catch(() => {});
  }
  await notifyLayer4Telegram(notifyText, workspace);
}
