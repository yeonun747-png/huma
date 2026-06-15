import type { Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { normalizeHashtagTag } from '../../../lib/hashtag-sanitize.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { humanTypeIntoElement } from '../../human-engine/korean-ime.js';
import { humanSleep } from '../../human-engine/typing.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import { prepareSeOneEditorSurface } from './enter-blog-editor.js';
import {
  findVisibleLocator,
  clickVisibleLocator,
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
  '.se-popup-publish input[type="text"]',
];

const CONFIRM_PUBLISH_SELECTORS = [
  '.se-popup-publish .btn_publish',
  '.se-popup-publish button[class*="publish"]',
  '.se-popup-publish .confirm_btn',
  '.se-popup-publish button.se-popup-button-confirm',
  '[class*="publish_layer"] .btn_publish',
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

async function isPublishLayerVisible(page: Page): Promise<boolean> {
  for (const sel of PUBLISH_LAYER_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return true;
    }
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
    await clickVisibleLocator(page, trigger).catch(() => {});
    return false;
  }

  await clickVisibleLocator(page, option);
  await scaledHumanSleep(300, 700, scale);
  return true;
}

export async function typePublishTags(
  page: Page,
  hashtags: string[],
  humanConfig: HumanEngineConfig,
  scale = 1,
): Promise<boolean> {
  const tags = hashtags.map((t) => normalizeHashtagTag(t)).filter(Boolean);
  if (!tags.length) return false;

  const input = await findVisibleLocator(page, TAG_INPUT_SELECTORS, { inFrame: false });
  if (!input) return false;

  for (let i = 0; i < tags.length; i += 1) {
    if (i === 0) {
      await humanClickLocator(page, input);
      await scaledHumanSleep(300, 600, scale);
    }
    await humanTypeIntoElement(page, input, tags[i]!, humanConfig, { skipFocus: i > 0 });
    await scaledHumanSleep(180, 450, scale);
    await page.keyboard.press('Enter');
    await scaledHumanSleep(350, 750, scale);
  }

  await scaledHumanSleep(400, 900, scale);
  return true;
}

export async function clickConfirmPublish(page: Page): Promise<void> {
  if (!(await isPublishLayerVisible(page))) {
    throw new Error('NAVER_PUBLISH_LAYER_CLOSED');
  }

  const layer = await findVisibleLocator(page, PUBLISH_LAYER_SELECTORS, { inFrame: false });

  if (layer) {
    for (const sel of [
      '.btn_publish',
      '.confirm_btn',
      'button[class*="confirm"]',
      'button.se-popup-button-confirm',
    ]) {
      const btn = layer.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        await clickVisibleLocator(page, btn);
        return;
      }
    }

    const footerPublish = layer.locator('button').filter({ hasText: /^발행$/ }).last();
    if (
      (await footerPublish.count()) > 0 &&
      (await footerPublish.isVisible({ timeout: 3000 }).catch(() => false))
    ) {
      await clickVisibleLocator(page, footerPublish);
      return;
    }
  }

  const confirm = await findVisibleLocator(page, CONFIRM_PUBLISH_SELECTORS, { inFrame: false });
  if (confirm) {
    await clickVisibleLocator(page, confirm);
    return;
  }

  throw new Error('NAVER_CONFIRM_PUBLISH_NOT_FOUND');
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
  const page = params.page;

  await prepareSeOneEditorSurface(page, 6_000, { destructiveDraftDismiss: false });

  await clickTopPublishButton(page);
  await scaledHumanSleep(600, 1200, scale);

  if (!(await waitForPublishLayer(page))) {
    throw new Error('NAVER_PUBLISH_LAYER_NOT_FOUND');
  }

  const category =
    params.category?.trim() ||
    DEFAULT_CATEGORY_BY_WORKSPACE[params.workspace ?? 'yeonun'] ||
    '포스팅';

  await selectPublishCategory(page, category, scale).catch(() => false);

  if (params.hashtags?.length) {
    await typePublishTags(page, params.hashtags, params.humanConfig, scale);
  }

  await scaledHumanSleep(400, 900, scale);

  if (!(await isPublishLayerVisible(page))) {
    await clickTopPublishButton(page);
    await waitForPublishLayer(page);
  }

  await clickConfirmPublish(page);
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});

  return waitForNaverPublishSuccess(page);
}
