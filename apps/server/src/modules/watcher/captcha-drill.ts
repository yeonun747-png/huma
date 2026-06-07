import type { Workspace } from '@huma/shared';

import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { createBrowser, chromium } from '../playwright/browser.js';
import { enterCaptchaHold, getCaptchaHold, listCaptchaHoldJobIds } from './captcha-hold.js';
import { getTelegramEnvStatus } from './telegram.js';

const DRILL_ACCOUNT_ID = 'captcha-drill';
const DRILL_HOLD_MS = 5 * 60 * 1000;

const DRILL_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>huma CAPTCHA DRILL</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: system-ui, sans-serif;
      background: #fff8f0;
      color: #111;
    }
    .card {
      max-width: 720px; padding: 48px; border-radius: 16px;
      background: #fff; border: 4px solid #e94560;
      text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 { font-size: 2rem; margin: 0 0 16px; color: #e94560; }
    p { font-size: 1.15rem; line-height: 1.6; margin: 12px 0; }
    .steps { text-align: left; margin: 24px auto; max-width: 420px; }
    li { margin: 8px 0; }
    .badge { display: inline-block; padding: 6px 14px; background: #e94560; border-radius: 999px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">CAPTCHA DRILL · 연습</span>
    <h1>VNC 연결 테스트</h1>
    <p>이 화면이 보이면 VNC + Xvfb :99 가 정상입니다.</p>
    <ol class="steps">
      <li>Telegram 알림 확인</li>
      <li>romang-ai.com 큐 → CAPTCHA job → 발행 완료</li>
      <li>5분 후 자동 종료 (연습)</li>
    </ol>
    <p style="opacity:0.7;font-size:0.9rem">실제 네이버 캡cha가 아닙니다</p>
  </div>
</body>
</html>`;

export function isCaptchaDrillEnabled(): boolean {
  return process.env.HUMA_CAPTCHA_DRILL !== 'false';
}

export function getActiveCaptchaDrillJobId(): string | null {
  for (const jobId of listCaptchaHoldJobIds()) {
    const hold = getCaptchaHold(jobId);
    if (hold?.isDrill) return jobId;
  }
  return null;
}

/** Xvfb :99 — headful 강제, VNC에서 창이 보이도록 */
async function createDrillBrowser() {
  const display = process.env.DISPLAY?.trim() || ':99';
  if (process.platform === 'linux' && display !== ':99') {
    console.warn(`[captcha-drill] DISPLAY=${display} (권장 :99)`);
  }

  try {
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized',
        '--window-position=0,0',
        '--lang=ko-KR',
      ],
      env: {
        ...process.env,
        DISPLAY: display,
        LANG: 'ko_KR.UTF-8',
      },
    });
    const context = await browser.newContext({
      viewport: null,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    return { context, mode: 'headful' as const };
  } catch (err) {
    console.warn('[captcha-drill] headful launch failed, fallback createBrowser:', (err as Error).message);
    const { context } = await createBrowser();
    return { context, mode: 'fallback' as const };
  }
}

export async function startCaptchaDrill(
  workspace: Workspace,
): Promise<{
  jobId: string;
  workspace: Workspace;
  telegram: { ok: boolean; error?: string; skipped?: string; env: ReturnType<typeof getTelegramEnvStatus> };
  browser: { mode: string; display: string };
}> {
  if (!isCaptchaDrillEnabled()) {
    throw new Error('CAPTCHA_DRILL_DISABLED');
  }

  const active = getActiveCaptchaDrillJobId();
  if (active) {
    throw new Error(`CAPTCHA_DRILL_ALREADY_ACTIVE:${active}`);
  }

  const { data: job, error } = await supabase
    .from('huma_jobs')
    .insert({
      workspace,
      job_type: 'post_blog',
      title: '[DRILL] CAPTCHA 연습',
      content: 'Telegram · VNC · huma 발행완료 UI 연습용 (실발행 아님)',
      status: 'running',
      started_at: new Date().toISOString(),
      platform_schedule: { _captcha_drill: true },
    })
    .select('id')
    .single();

  if (error || !job?.id) {
    throw new Error(error?.message ?? 'DRILL_JOB_CREATE_FAILED');
  }

  const { context, mode } = await createDrillBrowser();
  const page = await context.newPage();
  await page.setContent(DRILL_HTML, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();

  const { telegram } = await enterCaptchaHold(
    {
      jobId: job.id,
      accountId: DRILL_ACCOUNT_ID,
      workspace,
      accountLabel: 'CAPTCHA DRILL',
      jobTitle: '[DRILL] CAPTCHA 연습',
      jobType: 'captcha_drill',
      context,
      releaseAccountLock: () => {},
    },
    { holdMs: DRILL_HOLD_MS, isDrill: true },
  );

  const telegramStatus = { ...telegram, env: getTelegramEnvStatus(workspace) };

  await logOperation({
    level: 'info',
    message: `CAPTCHA DRILL 시작 (${workspace}) — telegram=${telegramStatus.ok ? 'ok' : telegramStatus.error ?? telegramStatus.skipped} · browser=${mode}`,
    job_id: job.id,
    workspace,
  });

  return {
    jobId: job.id,
    workspace,
    telegram: telegramStatus,
    browser: { mode, display: process.env.DISPLAY?.trim() || ':99' },
  };
}
