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
  const schedule = params.payload.platform_schedule as Record<string, unknown> | undefined;
  const blogCategory =
    typeof schedule?.blog_category === 'string' ? schedule.blog_category : undefined;
  const videoPath =
    typeof params.payload.video_path === 'string' ? params.payload.video_path : undefined;

  return postNaverBlog({
    page: params.page,
    title: params.payload.title as string,
    content,
    imageUrls: imgs,
    linkUrl,
    hashtags: (params.payload.hashtags as string[]) ?? [],
    blogCategory,
    videoPath,
    workspace,
    humanEngine: params.humanConfig,
    persona: params.persona,
    rttScale: params.rttScale,
  });
}
