import type { BrowserContext, Page } from 'playwright';
import axios from 'axios';

import { supabase } from '../middleware/auth.js';
import { disableAutoPublish } from './auto-publish-state.js';
import { logOperation } from './log-emitter.js';
import { shouldNotifySlack } from './human-engine-policy.js';
import { notifyLayer4Telegram } from '../modules/watcher/telegram.js';

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

export function bodyIndicatesNaverAccountProtection(body: string): boolean {
  return PROTECTION_BODY_PATTERNS.some((re) => re.test(body));
}

export async function isNaverAccountProtectionPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (!url.includes('naver.com')) return false;

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
  if (await isNaverAccountProtectionPage(page)) {
    throw naverAccountProtectedError(phase);
  }
}

export async function throwIfNaverAccountProtectionInContext(
  context: BrowserContext,
  phase: NaverAccountProtectionPhase,
): Promise<void> {
  const hit = await findNaverAccountProtectionPage(context);
  if (hit) throw naverAccountProtectedError(phase);
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
  } else if (acc.auto_publish_enabled) {
    await supabase.from('huma_accounts').update({ auto_publish_enabled: false }).eq('id', accountId);
  }

  await supabase.from('huma_accounts').update({ is_active: false }).eq('id', accountId);

  const phaseKo = PHASE_LABEL[phase];
  const logMessage = `[naver] 아이디 보호조치 (${phaseKo}) — 계정 사용 중지 · 자동발행 OFF (${label}/${naverId})`;

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
    '조치: is_active OFF · 자동발행 OFF',
    'VNC에서 「보호조치 해제」 후 계정관리에서 수동 재투입',
  ].join('\n');

  if (await shouldNotifySlack()) {
    const webhook = process.env.SLACK_WEBHOOK_URL?.trim();
    if (webhook) await axios.post(webhook, { text: telegramText }).catch(() => {});
  }
  await notifyLayer4Telegram(telegramText, workspace);
}
