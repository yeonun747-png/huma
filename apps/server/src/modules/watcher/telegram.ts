import axios from 'axios';

import type { Workspace } from '@huma/shared';
import { shouldNotifyTelegram } from '../../lib/human-engine-policy.js';

const QUIZ_PANANA_WORKSPACES: Workspace[] = ['panana', 'quizoasis'];

export function resolveTelegramChatId(workspace?: string | null): string | null {
  if (workspace === 'yeonun') {
    return process.env.TELEGRAM_CHAT_ID_YEONUN?.trim() || null;
  }
  if (workspace && QUIZ_PANANA_WORKSPACES.includes(workspace as Workspace)) {
    return process.env.TELEGRAM_CHAT_ID_QUIZ_PANANA?.trim() || null;
  }
  return (
    process.env.TELEGRAM_CHAT_ID_YEONUN?.trim() ||
    process.env.TELEGRAM_CHAT_ID_QUIZ_PANANA?.trim() ||
    null
  );
}

export function resolveVncUrl(workspace?: string | null): string | null {
  if (workspace === 'yeonun') {
    return process.env.HUMA_VNC_URL_YEONUN?.trim() || null;
  }
  if (workspace && QUIZ_PANANA_WORKSPACES.includes(workspace as Workspace)) {
    return process.env.HUMA_VNC_URL_QUIZ_PANANA?.trim() || null;
  }
  return (
    process.env.HUMA_VNC_URL_YEONUN?.trim() ||
    process.env.HUMA_VNC_URL_QUIZ_PANANA?.trim() ||
    null
  );
}

export function buildJobWebUrl(jobId: string): string | null {
  const base = process.env.HUMA_WEB_URL?.trim()?.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/queue?job=${encodeURIComponent(jobId)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function sendTelegramHtml(
  chatId: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN 없음' };
  if (!chatId) return { ok: false, error: 'chat_id 없음' };

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      },
      { timeout: 15_000 },
    );
    return { ok: true };
  } catch (err) {
    const ax = err as {
      response?: { status?: number; data?: { description?: string } };
      message?: string;
      code?: string;
    };
    const tg = ax.response?.data?.description;
    const detail =
      tg ??
      (ax.code === 'ECONNREFUSED' || ax.code === 'ENOTFOUND'
        ? `Telegram API 연결 실패 (${ax.code}) — i7 방화벽·DNS 확인`
        : ax.message ?? 'send failed');
    console.warn('[telegram] send failed:', detail);
    return { ok: false, error: detail };
  }
}

async function verifyTelegramBot(token: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  try {
    const { data } = await axios.get<{ ok?: boolean; result?: { username?: string }; description?: string }>(
      `https://api.telegram.org/bot${token}/getMe`,
      { timeout: 15_000 },
    );
    if (!data.ok || !data.result?.username) {
      return { ok: false, error: data.description ?? 'getMe 실패 — TELEGRAM_BOT_TOKEN 확인' };
    }
    return { ok: true, username: data.result.username };
  } catch (err) {
    const ax = err as {
      response?: { data?: { description?: string } };
      message?: string;
      code?: string;
    };
    const detail =
      ax.response?.data?.description ??
      (ax.code === 'ECONNREFUSED' || ax.code === 'ENOTFOUND'
        ? `Telegram API 연결 불가 (${ax.code}) — i7에서 curl api.telegram.org 확인`
        : ax.message ?? 'getMe failed');
    return { ok: false, error: detail };
  }
}

export function getTelegramEnvStatus(workspace?: string | null): {
  hasToken: boolean;
  chatId: string | null;
  webUrl: boolean;
  vncUrl: boolean;
} {
  return {
    hasToken: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    chatId: resolveTelegramChatId(workspace),
    webUrl: Boolean(process.env.HUMA_WEB_URL?.trim()),
    vncUrl: Boolean(resolveVncUrl(workspace)),
  };
}

export async function notifyTelegram(
  message: string,
  workspace?: string | null,
): Promise<void> {
  if (!(await shouldNotifyTelegram())) return;
  const chatId = resolveTelegramChatId(workspace);
  if (!chatId) return;
  await sendTelegramHtml(chatId, escapeHtml(message));
}

export interface CaptchaTelegramParams {
  jobId: string;
  workspace?: string | null;
  accountLabel?: string;
  jobTitle?: string;
  jobType?: string;
  remind?: boolean;
  remindIndex?: number;
  timedOut?: boolean;
  completed?: boolean;
  drill?: boolean;
  /** DRILL 등 — 설정 토글 무시하고 token+chat_id 있으면 발송 */
  force?: boolean;
}

export async function notifyCaptchaTelegram(
  params: CaptchaTelegramParams,
): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  if (!params.force && !(await shouldNotifyTelegram())) {
    return { ok: false, skipped: 'Telegram 알림 꺼짐 또는 env 미설정' };
  }
  const chatId = resolveTelegramChatId(params.workspace);
  if (!chatId) {
    return { ok: false, error: `chat_id 없음 (workspace=${params.workspace ?? '?'})` };
  }

  const webUrl = buildJobWebUrl(params.jobId);
  const vncUrl = resolveVncUrl(params.workspace);
  const title = params.jobTitle?.trim() || params.jobType || 'post_blog';
  const account = params.accountLabel?.trim() || '—';

  let head: string;
  if (params.completed) {
    head = params.drill ? '✅ huma · CAPTCHA 연습(DRILL) 완료' : '✅ huma · CAPTCHA 해결 완료';
  } else if (params.timedOut) {
    head = params.drill
      ? '⏱ huma · CAPTCHA 연습(DRILL) 시간 초과'
      : '⏱ huma · CAPTCHA 시간 초과 (30분)';
  } else if (params.remind) {
    head = params.drill
      ? `🔔 huma · CAPTCHA 연습 재알림 (${params.remindIndex ?? '?'}/1)`
      : `🔔 huma · CAPTCHA 재알림 (${params.remindIndex ?? '?'}/3)`;
  } else {
    head = params.drill
      ? '🧪 huma · CAPTCHA 연습(DRILL) — VNC 확인 후 huma에서 발행 완료'
      : '⚠️ huma · CAPTCHA — VNC에서 해결 후 huma에서 발행 완료';
  }

  const lines = [
    `<b>${escapeHtml(head)}</b>`,
    `계정: ${escapeHtml(account)}`,
    `작업: ${escapeHtml(title)}`,
    `job: <code>${escapeHtml(params.jobId)}</code>`,
  ];

  if (!params.completed && !params.timedOut) {
    lines.push('', '1) VNC 접속 → 캡cha 풀기 → 발행', '2) huma 큐 → 발행 완료 (URL 선택)');
  }

  if (webUrl) {
    lines.push('', `<a href="${escapeHtml(webUrl)}">huma 큐 열기</a>`);
  }
  if (vncUrl && !params.completed) {
    lines.push(`VNC: <a href="${escapeHtml(vncUrl)}">${escapeHtml(vncUrl)}</a>`);
  }

  return sendTelegramHtml(chatId, lines.join('\n'));
}

/** env·Bot API 연결만 빠르게 확인 */
export async function sendTelegramTest(workspace?: string | null): Promise<{
  ok: boolean;
  chatId: string | null;
  botUsername?: string;
  error?: string;
  env: ReturnType<typeof getTelegramEnvStatus>;
}> {
  const env = getTelegramEnvStatus(workspace);
  if (!env.hasToken) {
    return { ok: false, chatId: env.chatId, error: 'TELEGRAM_BOT_TOKEN 없음', env };
  }
  if (!env.chatId) {
    return { ok: false, chatId: null, error: 'chat_id 없음 — TELEGRAM_CHAT_ID_* 확인', env };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
  const bot = await verifyTelegramBot(token);
  if (!bot.ok) {
    return { ok: false, chatId: env.chatId, error: bot.error, env };
  }

  const r = await sendTelegramHtml(
    env.chatId,
    `<b>huma Telegram 테스트</b>\nworkspace: ${escapeHtml(workspace ?? 'default')}\n@${escapeHtml(bot.username)} 연결 OK`,
  );
  return {
    ok: r.ok,
    chatId: env.chatId,
    botUsername: bot.username,
    error: r.error,
    env,
  };
}
