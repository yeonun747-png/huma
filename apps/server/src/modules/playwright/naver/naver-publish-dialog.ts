import type { Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { humanSleep } from '../../human-engine/typing.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import {
  dismissNaverBlogEditorOverlays,
  prepareSeOneEditorSurface,
  waitAndDismissDraftResumePopup,
} from './enter-blog-editor.js';
import {
  findVisibleLocator,
  clickVisibleLocator,
  insertTextIntoInputLocator,
} from './naver-editor-locators.js';
import { waitForNaverPublishSuccess } from './blog-editor-pipeline.js';

const PUBLISH_BTN_SELECTORS = [
  '[class*="publish_btn"]',
  '.publish-btn',
  'button.publish_btn',
  'header button:has-text("발행")',
  '.se-publish-button',
];

const PUBLISH_LAYER_SELECTORS = [
  '[class*="publish_layer"]',
  '[class*="PublishLayer"]',
  '.se-popup-publish',
  '[class*="layer_publish"]',
  '.publish_popup',
];

const CATEGORY_SELECTORS = [
  '[class*="category"] button',
  '[class*="category"] select',
  '.selectbox button',
  'button[class*="category"]',
];

const TAG_INPUT_SELECTORS = [
  'input[placeholder*="태그"]',
  'input[placeholder*="tag"]',
  '#tagText',
  '.tag_input input',
  '[class*="tag"] input[type="text"]',
];

const CONFIRM_PUBLISH_SELECTORS = [
  '[class*="publish_layer"] button[class*="confirm"]',
  '[class*="publish_layer"] .confirm_btn',
  '[class*="PublishLayer"] button:has-text("발행")',
  '.se-popup-publish button:has-text("발행")',
  'button.confirm_btn',
  '[class*="layer_publish"] button:has-text("발행")',
];

const DEFAULT_CATEGORY_BY_WORKSPACE: Record<string, string> = {
  yeonun: '포스팅',
  quizoasis: '포스팅',
  panana: '포스팅',
};

export async function clickTopPublishButton(page: Page): Promise<void> {
  const btn = await findVisibleLocator(page, PUBLISH_BTN_SELECTORS, { inFrame: false });
  if (!btn) {
    throw new Error('NAVER_PUBLISH_BTN_NOT_FOUND');
  }
  await clickVisibleLocator(page, btn);
}

async function waitForPublishLayer(page: Page, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of PUBLISH_LAYER_SELECTORS) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        return true;
      }
    }
    await sleep(300);
  }
  return false;
}

export async function selectPublishCategory(
  page: Page,
  categoryName: string,
  scale = 1,
): Promise<boolean> {
  const trigger = await findVisibleLocator(page, CATEGORY_SELECTORS, { inFrame: false });
  if (!trigger) return false;

  await clickVisibleLocator(page, trigger);
  await scaledHumanSleep(400, 900, scale);

  const optionSelectors = [
    `button:has-text("${categoryName}")`,
    `li:has-text("${categoryName}")`,
    `[role="option"]:has-text("${categoryName}")`,
    `a:has-text("${categoryName}")`,
  ];

  const option = await findVisibleLocator(page, optionSelectors, { inFrame: false });
  if (!option) {
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }

  await clickVisibleLocator(page, option);
  await scaledHumanSleep(300, 700, scale);
  return true;
}

export async function typePublishTags(
  page: Page,
  hashtags: string[],
  _humanConfig: HumanEngineConfig,
  scale = 1,
): Promise<boolean> {
  const tags = hashtags
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  if (!tags.length) return false;

  const input = await findVisibleLocator(page, TAG_INPUT_SELECTORS, { inFrame: false });
  if (!input) return false;

  await humanClickLocator(page, input);

  for (let i = 0; i < tags.length; i++) {
    await insertTextIntoInputLocator(input, `#${tags[i]!}`);
    await scaledHumanSleep(200, 550, scale);
    await input.press(i < tags.length - 1 || Math.random() < 0.75 ? 'Space' : 'Enter');
    await scaledHumanSleep(400, 900, scale);
  }

  await scaledHumanSleep(500, 1200, scale);
  return true;
}

export async function clickConfirmPublish(page: Page): Promise<void> {
  const confirm = await findVisibleLocator(page, CONFIRM_PUBLISH_SELECTORS, { inFrame: false });
  if (!confirm) {
    const layer = await findVisibleLocator(page, PUBLISH_LAYER_SELECTORS, { inFrame: false });
    if (layer) {
      const fallback = layer.locator('button:has-text("발행")').last();
      if ((await fallback.count()) > 0) {
        await clickVisibleLocator(page, fallback);
        return;
      }
    }
    throw new Error('NAVER_CONFIRM_PUBLISH_NOT_FOUND');
  }
  await clickVisibleLocator(page, confirm);
}

export async function completeNaverPublishDialog(params: {
  page: Page;
  workspace?: string;
  category?: string;
  hashtags?: string[];
  humanConfig: HumanEngineConfig;
  scale?: number;
}): Promise<string> {
  const scale = params.scale ?? 1;

  await prepareSeOneEditorSurface(params.page, 12_000);
  await waitAndDismissDraftResumePopup(params.page, 5_000);
  await dismissNaverBlogEditorOverlays(params.page);

  await clickTopPublishButton(params.page);
  await scaledHumanSleep(800, 1800, scale);

  const layerVisible = await waitForPublishLayer(params.page);
  if (!layerVisible) {
    await humanSleep(1000, 2000);
  }

  const category =
    params.category?.trim() ||
    DEFAULT_CATEGORY_BY_WORKSPACE[params.workspace ?? 'yeonun'] ||
    '포스팅';

  await selectPublishCategory(params.page, category, scale).catch(() => false);

  if (params.hashtags?.length) {
    await typePublishTags(params.page, params.hashtags, params.humanConfig, scale).catch(() => false);
  }

  await scaledHumanSleep(600, 1400, scale);
  await dismissNaverBlogEditorOverlays(params.page);
  await clickConfirmPublish(params.page);
  await params.page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});

  return waitForNaverPublishSuccess(params.page);
}
