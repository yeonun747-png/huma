import type { Page } from 'playwright';
import { writeCafePost } from '../../playwright/naver/cafe.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';

export async function executeCafePost(params: {
  page: Page;
  payload: Record<string, unknown>;
  humanConfig: HumanEngineConfig;
}) {
  return writeCafePost({
    page: params.page,
    menuId: (params.payload.menuId as string) || process.env.JEOMSAMO_MENU_ID || '',
    title: params.payload.title as string,
    content: params.payload.content as string,
    humanEngine: params.humanConfig,
  });
}
