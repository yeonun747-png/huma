import type { BrowserContext } from 'playwright';

/** v3.25 — crank 본 세션 데이터 절약 (워밍업 페이지에는 적용하지 않음) */
export async function applyCrankResourceBlocking(context: BrowserContext): Promise<void> {
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2}', (route) =>
    route.abort(),
  );
}
