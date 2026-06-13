import axios from 'axios';
import https from 'node:https';

import type { Workspace } from '@huma/shared';
import { shouldNotifyTelegram } from '../../lib/human-engine-policy.js';

/** curl은 되는데 Node axios만 실패하는 IPv6 이슈 회피 */
const telegramHttpsAgent = new https.Agent({ family: 4, keepAlive: true });

const TELEGRAM_AXIOS_OPTS = {
  timeout: 15_000,
  httpsAgent: telegramHttpsAgent,
  proxy: false as const,
};

function formatTelegramAxiosError(err: unknown, fallback: string): string {
  const ax = err as {
    response?: { status?: number; data?: { description?: string; error_code?: number } };
    message?: string;
    code?: string;
  };
  const tg = ax.response?.data?.description?.trim();
  if (tg) return tg;
  const code = ax.code?.trim();
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return `Telegram API 연결 실패 (${code}) — i7 DNS·방화벽·IPv6 확인 (curl OK·Node 실패 시 pm2 NODE_OPTIONS=--dns-result-order=ipv4first)`;
  }
  const msg = ax.message?.trim();
  if (msg) return msg;
  const status = ax.response?.status;
  if (status) return `Telegram HTTP ${status}`;
  return fallback;
}

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
    const { data } = await axios.post<{ ok?: boolean; description?: string }>(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      },
      TELEGRAM_AXIOS_OPTS,
    );
    if (!data.ok) {
      const detail = data.description?.trim() || 'sendMessage ok:false';
      console.warn('[telegram] send failed:', detail);
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = formatTelegramAxiosError(err, 'sendMessage failed');
    console.warn('[telegram] send failed:', detail, err);
    return { ok: false, error: detail };
  }
}

export async function sendTelegramPhoto(
  chatId: string,
  photoPath: string,
  captionHtml: string,
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN 없음' };
  if (!chatId) return { ok: false, error: 'chat_id 없음' };

  try {
    const buf = await import('node:fs/promises').then((fs) => fs.readFile(photoPath));
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', new Blob([buf], { type: 'image/png' }), 'captcha.png');
    form.append('caption', captionHtml.slice(0, 1020));
    form.append('parse_mode', 'HTML');

    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (!data.ok) {
      const detail = data.description?.trim() || 'sendPhoto ok:false';
      console.warn('[telegram] photo send failed:', detail);
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (err) {
    const detail = formatTelegramAxiosError(err, 'sendPhoto failed');
    console.warn('[telegram] photo send failed:', detail, err);
    return { ok: false, error: detail };
  }
}

async function verifyTelegramBot(token: string): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  try {
    const { data } = await axios.get<{ ok?: boolean; result?: { username?: string }; description?: string }>(
      `https://api.telegram.org/bot${token}/getMe`,
      TELEGRAM_AXIOS_OPTS,
    );
    if (!data.ok || !data.result?.username) {
      return { ok: false, error: data.description?.trim() || 'getMe 실패 — TELEGRAM_BOT_TOKEN 확인' };
    }
    return { ok: true, username: data.result.username };
  } catch (err) {
    return { ok: false, error: formatTelegramAxiosError(err, 'getMe failed') };
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
  /** Claude Vision 3회 실패 후 VNC 폴백 */
  visionAutoFailed?: boolean;
  /** VNC 3열 타일 — 어느 창인지 */
  vncSlotLabel?: string;
  /** CAPTCHA 화면 캡처 파일 (텔레그램 sendPhoto) */
  screenshotPath?: string | null;
  /** 2중·재출제 CAPTCHA */
  secondCaptcha?: boolean;
  secondCaptchaRound?: number;
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
  } else if (params.visionAutoFailed) {
    head = params.drill
      ? '🧪 huma · Vision 3회 실패, VNC 필요 (DRILL)'
      : '⚠️ huma · Vision 3회 실패, VNC 필요';
  } else if (params.secondCaptcha) {
    head = params.drill
      ? `🔄 huma · CAPTCHA 재출제 (DRILL · ${params.secondCaptchaRound ?? 2}차)`
      : `🔄 huma · CAPTCHA 재출제 (2중 캡차 · ${params.secondCaptchaRound ?? 2}차)`;
  } else {
    head = params.drill
      ? '🧪 huma · CAPTCHA 연습(DRILL) — VNC 확인 후 huma에서 발행 완료'
      : '⚠️ huma · CAPTCHA — VNC에서 해결 후 huma에서 발행 완료';
  }

  const lines = [
    `<b>${escapeHtml(head)}</b>`,
    `계정: ${escapeHtml(account)}`,
    `작업: ${escapeHtml(title)}`,
    ...(params.vncSlotLabel ? [`창: ${escapeHtml(params.vncSlotLabel)}`] : []),
    `job: <code>${escapeHtml(params.jobId)}</code>`,
  ];

  if (!params.completed && !params.timedOut) {
    if (params.secondCaptcha) {
      lines.push(
        '',
        '비밀번호는 서버가 로그인 폼에 <b>다시 자동 재입력</b>했습니다.',
        'huma 큐 → CAPTCHA 정답 원격 입력에서 <b>새 캡처</b>를 확인하고 정답을 다시 제출하세요.',
      );
    } else if (params.visionAutoFailed) {
      lines.push('', 'Claude Vision 자동 해결 3회 실패 — VNC에서 수동 해결 필요');
    }
    if (params.jobType === 'social_crank') {
      lines.push(
        '',
        '1) VNC 접속 → 캡cha·2FA·기기인증 등 해결',
        '2) huma 큐 → 활동 재개 (C-Rank)',
      );
    } else {
      lines.push(
        '',
        '비밀번호는 서버가 VNC 로그인 폼에 자동 재입력했습니다.',
        '1) VNC 접속 → CAPTCHA 풀기(또는 huma 정답 원격 입력) → 로그인',
        '2) huma 큐 → 발행 재개',
        '※ CAPTCHA 이미지는 텔레그램·huma 팝업에 캡처로 함께 표시됩니다.',
      );
    }
  }

  if (webUrl) {
    lines.push('', `<a href="${escapeHtml(webUrl)}">huma 큐 열기</a>`);
  }
  if (vncUrl && !params.completed) {
    lines.push(`VNC: <a href="${escapeHtml(vncUrl)}">${escapeHtml(vncUrl)}</a>`);
  }

  const caption = lines.join('\n');

  if (params.screenshotPath && !params.completed && !params.timedOut) {
    const photo = await sendTelegramPhoto(chatId, params.screenshotPath, caption);
    if (photo.ok) return photo;
    console.warn('[telegram] captcha photo fallback to text:', photo.error);
  }

  return sendTelegramHtml(chatId, caption);
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
