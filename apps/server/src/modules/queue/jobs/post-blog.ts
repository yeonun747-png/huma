import type { Page } from 'playwright';
import { postNaverBlog } from '../../playwright/naver/blog-editor.js';
import { uniquifyImageFromUrl } from '../../image/uniquify.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../../playwright/persona.js';
import type { ContentType } from '@huma/shared';
import { prepareBlogPostForPlaywright } from '../../../lib/naver-post-sanitize.js';

export async function executePostBlog(params: {
  page: Page;
  payload: Record<string, unknown>;
  humanConfig: HumanEngineConfig;
  persona?: AccountPersona;
  rttScale?: number;
}) {
  const workspace = String(params.payload.workspace ?? 'yeonun');
  const { content, linkUrl } = prepareBlogPostForPlaywright(
    String(params.payload.content ?? ''),
    workspace,
    params.payload.linkUrl as string | undefined,
    params.payload.contentType as ContentType | undefined,
  );
  const imgs = await Promise.all(((params.payload.imageUrls as string[]) || []).map(uniquifyImageFromUrl));
  return postNaverBlog({
    page: params.page,
    title: params.payload.title as string,
    content,
    imageUrls: imgs,
    linkUrl,
    workspace,
    humanEngine: params.humanConfig,
    persona: params.persona,
    rttScale: params.rttScale,
  });
}
