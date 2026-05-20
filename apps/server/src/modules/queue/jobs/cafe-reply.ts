import type { Page } from 'playwright';
import { writeCafeReply } from '../../playwright/naver/cafe.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';

export async function executeCafeReply(params: {
  page: Page;
  payload: Record<string, unknown>;
  humanConfig: HumanEngineConfig;
}) {
  await writeCafeReply({
    page: params.page,
    postUrl: params.payload.postUrl as string,
    replyContent: params.payload.replyContent as string,
    humanEngine: params.humanConfig,
  });
  return { resultUrl: params.payload.postUrl as string };
}
