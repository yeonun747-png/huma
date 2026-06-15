import axios from 'axios';

import { submitCaptchaAnswerForJob } from '../../lib/captcha-answer-submit.js';
import {
  lookupCaptchaJobByTelegramReply,
} from '../../lib/captcha-telegram-registry.js';
import { getCaptchaHold, listCaptchaHoldJobIds } from './captcha-hold.js';
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

let pollOffset = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let stopped = false;

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
  if (!isAllowedTelegramChatId(chatId)) {
    console.warn(
      `[telegram-inbound] ignored chat ${normalizeTelegramChatId(chatId)} (env yeonun=${process.env.TELEGRAM_CHAT_ID_YEONUN ?? '?'})`,
    );
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

async function pollTelegramUpdates(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || stopped) return;

  polling = true;
  try {
    const { data } = await axios.get<{
      ok?: boolean;
      result?: TelegramUpdate[];
      description?: string;
    }>(`https://api.telegram.org/bot${token}/getUpdates`, {
      ...TELEGRAM_AXIOS_OPTS,
      timeout: 35_000,
      params: {
        offset: pollOffset,
        timeout: 25,
        allowed_updates: JSON.stringify(['message']),
      },
    });

    if (!data.ok) {
      console.warn('[telegram-inbound] getUpdates:', data.description ?? 'ok:false');
      return;
    }

    for (const update of data.result ?? []) {
      pollOffset = update.update_id + 1;
      await handleTelegramUpdate(update).catch((err) => {
        console.warn('[telegram-inbound] handle update failed:', (err as Error).message);
      });
    }
  } catch (err) {
    console.warn('[telegram-inbound]', formatTelegramAxiosError(err, 'getUpdates failed'));
  } finally {
    polling = false;
    if (!stopped) {
      pollTimer = setTimeout(() => void pollTelegramUpdates(), 400);
    }
  }
}

/** 텔레그램 답장·메시지로 CAPTCHA 정답 수신 (long polling) */
export function startTelegramCaptchaInbound(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;

  stopped = false;
  console.info('[telegram-inbound] CAPTCHA 정답 수신 폴링 시작');
  void axios
    .post(
      `https://api.telegram.org/bot${token}/deleteWebhook`,
      { drop_pending_updates: false },
      TELEGRAM_AXIOS_OPTS,
    )
    .catch(() => {});
  void pollTelegramUpdates();
}

export function stopTelegramCaptchaInbound(): void {
  stopped = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
