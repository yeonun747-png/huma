import type { Page } from 'playwright';
import { humanType, humanSleep } from '../../human-engine/typing.js';
import { scrollReview } from '../../human-engine/timing.js';
import { randomBetween } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { uniquifyImageFromUrl } from '../../image/uniquify.js';

export async function postNaverBlog(params: {
  page: Page;
  title: string;
  content: string;
  imageUrls?: string[];
  linkUrl?: string;
  humanEngine: HumanEngineConfig;
}) {
  await params.page.goto('https://blog.naver.com/write');
  await params.page.waitForLoadState('networkidle');
  await humanSleep(1000, 2000);

  await humanType(params.page, params.page.locator('#subjectTextBox'), params.title, params.humanEngine);
  await humanSleep(2000, 5000);

  const editor = params.page.frameLocator('#mainFrame').locator('.se-content');
  await editor.click();

  for (const para of params.content.split('\n\n')) {
    await humanType(params.page, editor, para, params.humanEngine);
    await humanSleep(2000, 8000);
    await params.page.keyboard.press('Enter');
    await params.page.keyboard.press('Enter');
  }

  if (params.linkUrl) {
    await humanType(params.page, editor, `\n\n${params.linkUrl}`, params.humanEngine);
  }

  if (params.imageUrls?.length) {
    for (const url of params.imageUrls) {
      await insertImage(params.page, await uniquifyImageFromUrl(url));
      await humanSleep(1000, 3000);
    }
  }

  await scrollReview(
    params.page,
    randomBetween(params.humanEngine.review_duration_ms[0], params.humanEngine.review_duration_ms[1])
  );

  await params.page.locator('.publish-btn').click();
  await params.page.waitForLoadState('networkidle');
  return { resultUrl: params.page.url() };
}

async function insertImage(page: Page, localPath: string) {
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(localPath);
    await humanSleep(2000, 4000);
  }
}
