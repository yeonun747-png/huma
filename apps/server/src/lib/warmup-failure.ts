import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import type { Page } from 'playwright';
import { notifySlack } from '../modules/watcher/detector.js';
import type { NaverSearchCollectDiagnostics } from './naver-search-links.js';

export type WarmupFailureReason = 'connection' | 'block_captcha' | 'dom_mismatch' | 'filter_zero';

const REASON_LABEL: Record<WarmupFailureReason, string> = {
  connection: '접속 실패',
  block_captcha: '차단·캡차',
  dom_mismatch: 'DOM 불일치',
  filter_zero: '링크 필터로 0개',
};

export function warmupFailureReasonLabel(reason: WarmupFailureReason): string {
  return REASON_LABEL[reason];
}

function debugDir(): string {
  return process.env.HUMA_WARMUP_DEBUG_DIR?.trim() || '/tmp/huma-warmup-debug';
}

async function uploadScreenshot(buf: Buffer, fileName: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  const supa = createClient(url, key);
  const path = `warmup-debug/${fileName}`;
  const { error } = await supa.storage.from('huma-media').upload(path, buf, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) return null;
  return supa.storage.from('huma-media').getPublicUrl(path).data.publicUrl;
}

export async function saveWarmupScreenshot(page: Page): Promise<string | null> {
  try {
    const buf = await page.screenshot({ fullPage: false, type: 'png' });
    const fileName = `warmup_${Date.now()}.png`;
    const dir = debugDir();
    await mkdir(dir, { recursive: true });
    const localPath = join(dir, fileName);
    await writeFile(localPath, buf);

    const publicUrl = await uploadScreenshot(buf, fileName);
    return publicUrl ?? localPath;
  } catch {
    return null;
  }
}

async function pageHints(page: Page): Promise<{ title: string; bodySnippet: string; hasCaptchaUi: boolean }> {
  const title = (await page.title().catch(() => '')).slice(0, 120);
  const bodySnippet = (
    await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .slice(0, 400);
  const hasCaptchaUi = await page
    .locator('#captcha, .captcha, [id*="captcha"], iframe[src*="captcha"]')
    .first()
    .isVisible()
    .catch(() => false);
  return { title, bodySnippet, hasCaptchaUi };
}

export function classifyWarmupFailure(
  pageUrl: string,
  title: string,
  bodySnippet: string,
  hasCaptchaUi: boolean,
  diagnostics: NaverSearchCollectDiagnostics,
  navError?: string | null,
): WarmupFailureReason {
  if (navError?.trim()) return 'connection';

  const url = pageUrl.trim().toLowerCase();
  const t = title.toLowerCase();
  const body = bodySnippet.toLowerCase();

  if (!url || url === 'about:blank' || url.startsWith('chrome-error://')) {
    return 'connection';
  }

  if (
    hasCaptchaUi ||
    url.includes('captcha') ||
    (url.includes('nid.naver.com') && !url.includes('search.naver.com')) ||
    url.includes('help.naver.com') ||
    url.includes('security') ||
    t.includes('captcha') ||
    t.includes('보안') ||
    t.includes('자동입력') ||
    t.includes('접근') ||
    body.includes('자동입력 방지') ||
    body.includes('보안문자') ||
    body.includes('captcha')
  ) {
    return 'block_captcha';
  }

  if (diagnostics.rawHrefCount > 0 && diagnostics.passedFilterCount === 0) {
    return 'filter_zero';
  }

  if (!diagnostics.hasMainPack && !url.includes('search.naver.com') && !title.trim()) {
    return 'connection';
  }

  return 'dom_mismatch';
}

function encodeField(value: string): string {
  return encodeURIComponent(value);
}

export function buildWarmupFailureError(params: {
  context: string;
  reason: WarmupFailureReason;
  url: string;
  title: string;
  screenshot: string | null;
  diagnostics: NaverSearchCollectDiagnostics;
  navError?: string | null;
}): string {
  const parts = [
    `NO_LINKS_FOUND:warmup:${params.context}`,
    `reason=${params.reason}`,
    `url=${encodeField(params.url)}`,
    `title=${encodeField(params.title)}`,
    `raw=${params.diagnostics.rawHrefCount}`,
    `filtered=${params.diagnostics.rejectedByFilterCount}`,
    `main_pack=${params.diagnostics.hasMainPack ? '1' : '0'}`,
  ];
  if (params.screenshot) parts.push(`screenshot=${encodeField(params.screenshot)}`);
  if (params.navError?.trim()) parts.push(`nav=${encodeField(params.navError.slice(0, 200))}`);
  return parts.join('|');
}

export async function throwWarmupFailure(
  page: Page,
  context: string,
  diagnostics: NaverSearchCollectDiagnostics,
  navError?: string | null,
): Promise<never> {
  const pageUrl = page.url();
  const { title, bodySnippet, hasCaptchaUi } = await pageHints(page);
  const reason = classifyWarmupFailure(pageUrl, title, bodySnippet, hasCaptchaUi, diagnostics, navError);
  const screenshot = await saveWarmupScreenshot(page);
  const errorMessage = buildWarmupFailureError({
    context,
    reason,
    url: pageUrl,
    title,
    screenshot,
    diagnostics,
    navError,
  });

  const label = warmupFailureReasonLabel(reason);
  const slackText = [
    `워밍업 실패 [${label}] ${context}`,
    `url: ${pageUrl}`,
    `title: ${title}`,
    `raw=${diagnostics.rawHrefCount} filtered=${diagnostics.rejectedByFilterCount} main_pack=${diagnostics.hasMainPack}`,
    screenshot ? `screenshot: ${screenshot}` : null,
    navError ? `nav: ${navError.slice(0, 120)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  await notifySlack(slackText);
  throw new Error(errorMessage);
}
