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

export async function sendTelegramHtml(chatId: string, html: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId) return;

  await axios
    .post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    })
    .catch((err) => {
      console.warn('[telegram] send failed:', (err as Error).message);
    });
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
}

export async function notifyCaptchaTelegram(params: CaptchaTelegramParams): Promise<void> {
  if (!(await shouldNotifyTelegram())) return;
  const chatId = resolveTelegramChatId(params.workspace);
  if (!chatId) return;

  const webUrl = buildJobWebUrl(params.jobId);
  const vncUrl = resolveVncUrl(params.workspace);
  const title = params.jobTitle?.trim() || params.jobType || 'post_blog';
  const account = params.accountLabel?.trim() || '—';

  let head: string;
  if (params.completed) {
    head = '✅ huma · CAPTCHA 해결 완료';
  } else if (params.timedOut) {
    head = '⏱ huma · CAPTCHA 시간 초과 (30분)';
  } else if (params.remind) {
    head = `🔔 huma · CAPTCHA 재알림 (${params.remindIndex ?? '?'}/3)`;
  } else {
    head = '⚠️ huma · CAPTCHA — VNC에서 해결 후 huma에서 발행 완료';
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

  await sendTelegramHtml(chatId, lines.join('\n'));
}
