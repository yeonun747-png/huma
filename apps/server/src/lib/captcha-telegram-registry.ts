import { normalizeTelegramChatId } from '../modules/watcher/telegram.js';

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
  messageToJob.set(messageKey(chatId, messageId), jobId);
}

export function lookupCaptchaJobByTelegramReply(
  chatId: string | number,
  replyMessageId: number,
): string | null {
  return messageToJob.get(messageKey(chatId, replyMessageId)) ?? null;
}

export function clearCaptchaTelegramMessagesForJob(jobId: string): void {
  for (const [key, id] of messageToJob) {
    if (id === jobId) messageToJob.delete(key);
  }
}
