import { normalizeTelegramChatId } from '../modules/watcher/telegram.js';
import { telegramChatIdLookupVariants } from './telegram-chat-id-variants.js';

const messageToJob = new Map<string, string>();

function messageKey(chatId: string | number, messageId: number): string {
  return `${normalizeTelegramChatId(chatId)}:${messageId}`;
}

/** CAPTCHA 알림 발송 시 message_id → job_id 매핑 (텔레그램 답장 매칭) */
export function registerCaptchaTelegramOutboundMessage(
  chatId: string | number,
  messageId: number,
  jobId: string,
): void {
  for (const variant of telegramChatIdLookupVariants(chatId)) {
    messageToJob.set(messageKey(variant, messageId), jobId);
  }
}

export function lookupCaptchaJobByTelegramReply(
  chatId: string | number,
  replyMessageId: number,
): string | null {
  for (const variant of telegramChatIdLookupVariants(chatId)) {
    const jobId = messageToJob.get(messageKey(variant, replyMessageId));
    if (jobId) return jobId;
  }
  return null;
}

export function clearCaptchaTelegramMessagesForJob(jobId: string): void {
  for (const [key, id] of messageToJob) {
    if (id === jobId) messageToJob.delete(key);
  }
}

/** pm2 재시작 후 hold에 저장된 telegram message_id 재등록 */
export function rehydrateCaptchaTelegramRegistry(
  rows: Array<{ chatId: string; messageId: number; jobId: string }>,
): void {
  for (const row of rows) {
    registerCaptchaTelegramOutboundMessage(row.chatId, row.messageId, row.jobId);
  }
}
