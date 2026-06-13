import type { BrowserContext } from 'playwright';

/**
 * post_blog — 에디터·포털 로딩 가속 (C-Rank와 동일 패턴).
 * 로컬 filechooser 업로드는 네트워크 route와 무관하므로 발행용 이미지 삽입에 영향 없음.
 */
export async function applyPostingResourceBlocking(context: BrowserContext): Promise<void> {
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot}', (route) =>
    route.abort(),
  );
}
