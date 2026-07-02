import type { Page } from 'playwright';

import { sleep } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import { normalizeHashtagTag } from '../../../lib/hashtag-sanitize.js';
import { humanClickLocator, humanMouseMove } from '../../human-engine/mouse.js';
import { humanBriefPauseMs } from '../../human-engine/korean-ime.js';
import { humanSleep } from '../../human-engine/typing.js';
import { scaledHumanSleep } from '../../human-engine/timing.js';
import { pasteTextViaClipboardEvent } from './paste-clipboard-event.js';
import { prepareSeOneEditorSurface } from './enter-blog-editor.js';
import {
  findVisibleLocator,
  clickVisibleLocator,
} from './naver-editor-locators.js';
import { waitForNaverPublishSuccess } from './blog-editor-pipeline.js';
import {
  isPublishLayerVisible,
  waitForPublishLayer,
  PUBLISH_LAYER_SELECTORS,
} from './naver-publish-layer.js';

const PUBLISH_BTN_SELECTORS = [
  '[class*="publish_btn"]',
  '.publish-btn',
  'button.publish_btn',
  'header button:has-text("발행")',
  '.se-publish-button',
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

export async function moveMouseToTopPublishButton(page: Page): Promise<boolean> {
  const btn = await findVisibleLocator(page, PUBLISH_BTN_SELECTORS, { inFrame: false });
  if (!btn) return false;
  const box = await btn.boundingBox().catch(() => null);
  if (!box || box.width < 8 || box.height < 8) return false;
  await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
  await sleep(150);
  return true;
}

export async function clickTopPublishButton(page: Page): Promise<void> {
  const btn = await findVisibleLocator(page, PUBLISH_BTN_SELECTORS, { inFrame: false });
  if (!btn) {
    throw new Error('NAVER_PUBLISH_BTN_NOT_FOUND');
  }
  await clickVisibleLocator(page, btn);
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

export async function pastePublishTags(
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
    await humanClickLocator(page, input, undefined, [100, 280]);
    await humanSleep(
      Math.floor(humanBriefPauseMs(humanConfig, 0.1, 0.2) * scale),
      Math.floor(humanBriefPauseMs(humanConfig, 0.15, 0.35) * scale),
    );
    await pasteTextViaClipboardEvent(page, tags[i]!);
    const [pLo, pHi] = humanConfig.paragraph_pause_ms;
    await humanSleep(
      Math.floor(pLo * 0.06 * scale),
      Math.floor(pHi * 0.14 * scale),
    );
    await page.keyboard.press('Enter');
    await humanSleep(
      Math.floor(pLo * 0.08 * scale),
      Math.floor(pHi * 0.18 * scale),
    );
  }

  await scaledHumanSleep(400, 900, scale);
  return true;
}

/** @deprecated pastePublishTags */
export async function typePublishTags(
  page: Page,
  hashtags: string[],
  humanConfig: HumanEngineConfig,
  scale = 1,
): Promise<boolean> {
  return pastePublishTags(page, hashtags, humanConfig, scale);
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

async function fillPublishLayerFields(params: {
  page: Page;
  category: string;
  hashtags?: string[];
  humanConfig: HumanEngineConfig;
  scale: number;
}): Promise<void> {
  await selectPublishCategory(params.page, params.category, params.scale).catch(() => false);
  if (params.hashtags?.length) {
    await pastePublishTags(params.page, params.hashtags, params.humanConfig, params.scale);
  }
}

/** 발행 레이어가 닫혔으면 상단 발행 재클릭 후 카테고리·태그까지 다시 채움 */
async function ensurePublishLayerFilled(params: {
  page: Page;
  category: string;
  hashtags?: string[];
  humanConfig: HumanEngineConfig;
  scale: number;
}): Promise<void> {
  const { page, scale } = params;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await isPublishLayerVisible(page))) {
      await clickTopPublishButton(page);
      await scaledHumanSleep(600, 1200, scale);
      if (!(await waitForPublishLayer(page, 12_000))) {
        if (attempt >= 2) throw new Error('NAVER_PUBLISH_LAYER_NOT_FOUND');
        continue;
      }
    }

    await fillPublishLayerFields(params);
    await scaledHumanSleep(400, 900, scale);

    if (await isPublishLayerVisible(page)) return;

    await scaledHumanSleep(500, 1000, scale);
  }

  throw new Error('NAVER_PUBLISH_LAYER_CLOSED');
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

  const category =
    params.category?.trim() ||
    DEFAULT_CATEGORY_BY_WORKSPACE[params.workspace ?? 'yeonun'] ||
    '포스팅';

  await ensurePublishLayerFilled({
    page,
    category,
    hashtags: params.hashtags,
    humanConfig: params.humanConfig,
    scale,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await isPublishLayerVisible(page))) {
      await ensurePublishLayerFilled({
        page,
        category,
        hashtags: params.hashtags,
        humanConfig: params.humanConfig,
        scale,
      });
    }

    try {
      await clickConfirmPublish(page);
      break;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const retryable =
        msg.includes('NAVER_PUBLISH_LAYER_CLOSED') || msg.includes('NAVER_CONFIRM_PUBLISH_NOT_FOUND');
      if (!retryable || attempt >= 2) throw err;
      await ensurePublishLayerFilled({
        page,
        category,
        hashtags: params.hashtags,
        humanConfig: params.humanConfig,
        scale,
      });
    }
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});

  return waitForNaverPublishSuccess(page);
}

/** 발행 레이어 보호용 re-export */
export { isPublishLayerVisible } from './naver-publish-layer.js';
