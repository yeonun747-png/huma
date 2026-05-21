import type { Page } from 'playwright';
import { humanType, humanSleep } from '../../human-engine/typing.js';
import { scrollReview, smartType, scaledHumanSleep } from '../../human-engine/timing.js';
import { randomBetween } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../persona.js';
import { uniquifyImageFromUrl } from '../../image/uniquify.js';

function mergePersonaConfig(base: HumanEngineConfig, persona?: AccountPersona): HumanEngineConfig {
  if (!persona) return base;
  return {
    ...base,
    wpm_mean: persona.wpm,
    typo_rate: persona.typoRate,
  };
}

export async function navigateToBlogEditor(page: Page, persona: AccountPersona, humanEngine: HumanEngineConfig) {
  const config = mergePersonaConfig(humanEngine, persona);

  await page.goto('https://www.naver.com');
  await humanSleep(1500, 3000);

  const keyword = persona.interests[Math.floor(Math.random() * persona.interests.length)] ?? '운세';
  const searchBox = page.locator('#query');
  await searchBox.click();
  await humanType(page, searchBox, keyword, config);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');
  await humanSleep(1500, 4000);

  const results = await page.locator('.news_wrap a, .api_txt_lines').all();
  if (results.length) {
    const target = results[Math.floor(Math.random() * Math.min(4, results.length))];
    await target.click().catch(() => {});
    await humanSleep(3000, 8000);
    await page.goBack();
    await humanSleep(1000, 2000);
  }

  await page.goto('https://blog.naver.com');
  await humanSleep(1000, 2500);
  const writeBtn = page.locator('.btn_write, [class*="write"]').first();
  if (await writeBtn.count()) {
    await writeBtn.click();
  } else {
    await page.goto('https://blog.naver.com/write');
  }
  await page.waitForLoadState('networkidle');
}

export async function postNaverBlog(params: {
  page: Page;
  title: string;
  content: string;
  imageUrls?: string[];
  linkUrl?: string;
  humanEngine: HumanEngineConfig;
  persona?: AccountPersona;
  useOrganicNav?: boolean;
  rttScale?: number;
}) {
  const config = mergePersonaConfig(params.humanEngine, params.persona);
  const scale = params.rttScale ?? 1;

  if (params.useOrganicNav && params.persona) {
    await navigateToBlogEditor(params.page, params.persona, params.humanEngine);
  } else {
    await params.page.goto('https://blog.naver.com/write');
    await params.page.waitForLoadState('networkidle');
    await scaledHumanSleep(1000, 2000, scale);
  }

  await humanType(params.page, params.page.locator('#subjectTextBox'), params.title, config);
  await scaledHumanSleep(2000, 5000, scale);

  const editor = params.page.frameLocator('#mainFrame').locator('.se-content');
  await editor.click();

  await smartType(params.page, editor, params.content, config);

  if (params.linkUrl) {
    await smartType(params.page, editor, `\n\n${params.linkUrl}`, config);
  }

  if (params.imageUrls?.length) {
    for (const url of params.imageUrls) {
      await insertImage(params.page, await uniquifyImageFromUrl(url));
      await scaledHumanSleep(1000, 3000, scale);
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
