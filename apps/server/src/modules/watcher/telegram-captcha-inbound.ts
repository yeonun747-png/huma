import axios from 'axios';

import { submitCaptchaAnswerForJob } from '../../lib/captcha-answer-submit.js';
import {
  lookupCaptchaJobByTelegramReply,
  rehydrateCaptchaTelegramRegistry,
} from '../../lib/captcha-telegram-registry.js';
import { getCaptchaHold, listCaptchaHoldJobIds, listCaptchaHoldTelegramOutboundForRegistry } from './captcha-hold.js';
import {
  formatTelegramAxiosError,
  isAllowedTelegramChatId,
  normalizeTelegramChatId,
  parseCaptchaAnswerFromTelegram,
  registerTelegramChatIdMigration,
  resolveWorkspaceFromTelegramChatId,
  sendTelegramHtml,
  TELEGRAM_AXIOS_OPTS,
} from './telegram.js';

type TelegramMessage = {
  message_id: number;
  chat: { id: number; type?: string };
  text?: string;
  reply_to_message?: { message_id: number };
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

const processingJobs = new Set<string>();

const TELEGRAM_LONG_POLL_SEC = 25;
const TELEGRAM_HTTP_TIMEOUT_MS = (TELEGRAM_LONG_POLL_SEC + 15) * 1000;
const POLL_INTERVAL_MS = 400;
const CONFLICT_BACKOFF_MS = 15_000;

let pollOffset = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollAbort: AbortController | null = null;
let polling = false;
let stopped = false;
let inboundStarted = false;
let nextPollDelayMs = POLL_INTERVAL_MS;

function isTelegramGetUpdatesConflict(err: unknown): boolean {
  const ax = err as {
    response?: { status?: number; data?: { description?: string } };
    message?: string;
  };
  const description = ax.response?.data?.description ?? ax.message ?? '';
  return ax.response?.status === 409 || description.includes('Conflict');
}

function isPollAborted(err: unknown): boolean {
  if (!axios.isCancel(err)) return false;
  return stopped || pollAbort?.signal.aborted === true;
}

function lookupJobByReply(chatId: string | number, replyMessageId: number): string | null {
  return lookupCaptchaJobByTelegramReply(chatId, replyMessageId);
}

function listActiveHoldsForChat(chatId: string | number): string[] {
  const workspace = resolveWorkspaceFromTelegramChatId(chatId);
  if (!workspace) return [];

  return listCaptchaHoldJobIds().filter((jobId) => {
    const hold = getCaptchaHold(jobId);
    if (!hold) return false;
    const ws = hold.workspace ?? 'yeonun';
    if (workspace === 'yeonun') return ws === 'yeonun';
    return ws === 'panana' || ws === 'quizoasis';
  });
}

function resolveJobForInboundMessage(message: TelegramMessage): string | null {
  const chatId = message.chat.id;
  if (message.reply_to_message?.message_id) {
    const fromReply = lookupJobByReply(chatId, message.reply_to_message.message_id);
    if (fromReply) return fromReply;
  }

  const active = listActiveHoldsForChat(chatId);
  if (active.length === 1) return active[0]!;
  return null;
}

async function replyTelegram(chatId: number, html: string): Promise<void> {
  await sendTelegramHtml(String(chatId), html);
}

async function handleTelegramCaptchaAnswer(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const chatLabel = normalizeTelegramChatId(chatId);
  const preview = (message.text ?? '').trim().slice(0, 40);

  console.info(
    `[telegram-inbound] recv chat=${chatLabel} type=${message.chat.type ?? '?'} reply=${message.reply_to_message?.message_id ?? 'none'} text="${preview}"`,
  );

  if (!isAllowedTelegramChatId(chatId)) {
    console.warn(
      `[telegram-inbound] ignored chat ${chatLabel} (env yeonun=${process.env.TELEGRAM_CHAT_ID_YEONUN ?? '?'})`,
    );
    if (message.reply_to_message && preview) {
      await replyTelegram(
        chatId,
        `⚠️ chat_id 불일치 — 서버가 이 그룹 답장을 처리하지 못합니다.\n수신 id: <code>${chatLabel}</code>\nenv: <code>${process.env.TELEGRAM_CHAT_ID_YEONUN ?? '?'}</code>\n\n.env에 <code>TELEGRAM_CHAT_ID_YEONUN=${chatLabel}</code> (또는 쉼표로 병기) 후 pm2 restart huma-server`,
      );
    }
    return;
  }

  const answer = parseCaptchaAnswerFromTelegram(message.text ?? '');
  if (!answer) {
    const active = listActiveHoldsForChat(chatId);
    if (message.reply_to_message && active.length > 0) {
      await replyTelegram(
        chatId,
        '⚠️ 정답을 인식하지 못했습니다.\nCAPTCHA 알림에 <b>답장</b>으로 한글·숫자만 입력하거나 <code>정답: xxx</code> 형식으로 보내 주세요.',
      );
    }
    return;
  }

  const jobId = resolveJobForInboundMessage(message);
  if (!jobId) {
    const active = listActiveHoldsForChat(chatId);
    if (active.length > 1) {
      await replyTelegram(
        chatId,
        '⚠️ CAPTCHA 대기 작업이 여러 개입니다.\n캡cha 알림 메시지(사진)에 <b>답장</b>으로 정답을 보내 주세요.',
      );
      return;
    }
    await replyTelegram(
      chatId,
      '⚠️ 연결된 CAPTCHA job이 없습니다.\n· CAPTCHA <b>사진·알림에 답장</b>으로 정답을 보내 주세요\n· 그룹에서는 <b>답장</b>이 아니면 봇이 메시지를 받지 못할 수 있습니다 (BotFather → Group Privacy Off 권장)',
    );
    return;
  }

  console.info(
    `[telegram-inbound] CAPTCHA answer chat=${normalizeTelegramChatId(chatId)} job=${jobId} reply=${message.reply_to_message?.message_id ?? 'none'}`,
  );

  if (processingJobs.has(jobId)) return;
  processingJobs.add(jobId);
  try {
    const result = await submitCaptchaAnswerForJob(jobId, answer);
    if (!result.ok) {
      await replyTelegram(
        chatId,
        `❌ CAPTCHA 정답 처리 실패\njob: <code>${jobId}</code>\n${result.error ?? 'unknown'}`,
      );
      return;
    }

    if (result.captcha_cleared && !result.pending_login) {
      await replyTelegram(
        chatId,
        `✅ CAPTCHA 정답 제출 완료\njob: <code>${jobId}</code>\n로그인·발행 재개를 진행합니다.`,
      );
      return;
    }

    if (result.pending_login) {
      await replyTelegram(
        chatId,
        `✅ CAPTCHA 통과 — 로그인 확인 중\njob: <code>${jobId}</code>\n잠시 후 huma에서 발행 재개를 확인하세요.`,
      );
      return;
    }

    await replyTelegram(
      chatId,
      `🔄 정답 제출됨 — CAPTCHA가 남아 있거나 2중 캡cha일 수 있습니다.\njob: <code>${jobId}</code>\n새 캡처 알림을 확인하고 정답을 다시 보내 주세요.`,
    );
  } finally {
    processingJobs.delete(jobId);
  }
}

async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  if (message.migrate_to_chat_id) {
    registerTelegramChatIdMigration(message.chat.id, message.migrate_to_chat_id);
  }
  if (message.migrate_from_chat_id) {
    registerTelegramChatIdMigration(message.migrate_from_chat_id, message.chat.id);
  }

  if (!message.text) return;
  await handleTelegramCaptchaAnswer(message);
}

function scheduleNextPoll(delayMs = nextPollDelayMs): void {
  if (stopped) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void pollTelegramUpdates(), delayMs);
}

async function pollTelegramUpdates(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || stopped || polling) return;

  pollAbort = new AbortController();
  const signal = pollAbort.signal;

  polling = true;
  try {
    const { data } = await axios.get<{
      ok?: boolean;
      result?: TelegramUpdate[];
      description?: string;
    }>(`https://api.telegram.org/bot${token}/getUpdates`, {
      ...TELEGRAM_AXIOS_OPTS,
      signal,
      timeout: TELEGRAM_HTTP_TIMEOUT_MS,
      params: {
        offset: pollOffset,
        timeout: TELEGRAM_LONG_POLL_SEC,
        allowed_updates: JSON.stringify(['message']),
      },
    });

    if (!data.ok) {
      const description = data.description ?? 'ok:false';
      if (description.includes('Conflict')) {
        nextPollDelayMs = CONFLICT_BACKOFF_MS;
        console.warn(
          '[telegram-inbound] Conflict — 다른 getUpdates 소비자와 충돌. 15초 후 재시도 (브라우저 getUpdates 탭·중복 서버 확인)',
        );
      } else {
        console.warn('[telegram-inbound] getUpdates:', description);
      }
      return;
    }

    nextPollDelayMs = POLL_INTERVAL_MS;
    for (const update of data.result ?? []) {
      pollOffset = update.update_id + 1;
      await handleTelegramUpdate(update).catch((err) => {
        console.warn('[telegram-inbound] handle update failed:', (err as Error).message);
      });
    }
  } catch (err) {
    if (isPollAborted(err)) return;
    if (isTelegramGetUpdatesConflict(err)) {
      nextPollDelayMs = CONFLICT_BACKOFF_MS;
      console.warn(
        '[telegram-inbound] Conflict — 다른 getUpdates 소비자와 충돌. 15초 후 재시도 (브라우저 getUpdates 탭·중복 서버 확인)',
      );
      return;
    }
    console.warn('[telegram-inbound]', formatTelegramAxiosError(err, 'getUpdates failed'));
  } finally {
    polling = false;
    if (!stopped) scheduleNextPoll();
  }
}

function isTelegramInboundPollEnabled(): boolean {
  const flag = process.env.TELEGRAM_INBOUND_POLL?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'no') return false;
  if (flag === 'true' || flag === '1' || flag === 'on' || flag === 'yes') return true;
  return process.env.NODE_ENV === 'production';
}

/** 텔레그램 답장·메시지로 CAPTCHA 정답 수신 (long polling) */
export function startTelegramCaptchaInbound(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  if (!isTelegramInboundPollEnabled()) {
    console.info(
      `[telegram-inbound] getUpdates 폴링 비활성 — NODE_ENV=${process.env.NODE_ENV ?? 'unset'}, TELEGRAM_INBOUND_POLL=${process.env.TELEGRAM_INBOUND_POLL ?? 'unset'} (i7 production만 자동 활성)`,
    );
    return;
  }
  if (inboundStarted && !stopped) return;

  inboundStarted = true;
  stopped = false;
  nextPollDelayMs = POLL_INTERVAL_MS;
  const rehydrateRows = listCaptchaHoldTelegramOutboundForRegistry();
  if (rehydrateRows.length > 0) {
    rehydrateCaptchaTelegramRegistry(rehydrateRows);
    console.info(`[telegram-inbound] CAPTCHA 답장 매핑 ${rehydrateRows.length}건 복구`);
  }
  console.info(`[telegram-inbound] CAPTCHA 정답 수신 폴링 시작 pid=${process.pid}`);
  void axios
    .post(
      `https://api.telegram.org/bot${token}/deleteWebhook`,
      { drop_pending_updates: false },
      TELEGRAM_AXIOS_OPTS,
    )
    .catch(() => {})
    .finally(() => {
      if (!stopped) scheduleNextPoll(800);
    });
}

export function stopTelegramCaptchaInbound(): void {
  stopped = true;
  inboundStarted = false;
  pollAbort?.abort();
  pollAbort = null;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
