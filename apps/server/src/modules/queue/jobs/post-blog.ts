import type { Page } from 'playwright';
import { postNaverBlog } from '../../playwright/naver/blog-editor.js';
import { uniquifyImageFromUrl } from '../../image/uniquify.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../../playwright/persona.js';

export async function executePostBlog(params: {
  page: Page;
  payload: Record<string, unknown>;
  humanConfig: HumanEngineConfig;
  persona?: AccountPersona;
  useOrganicNav?: boolean;
  rttScale?: number;
}) {
  const imgs = await Promise.all(((params.payload.imageUrls as string[]) || []).map(uniquifyImageFromUrl));
  return postNaverBlog({
    page: params.page,
    title: params.payload.title as string,
    content: params.payload.content as string,
    imageUrls: imgs,
    linkUrl: params.payload.linkUrl as string,
    humanEngine: params.humanConfig,
    persona: params.persona,
    useOrganicNav: params.useOrganicNav,
    rttScale: params.rttScale,
  });
}
