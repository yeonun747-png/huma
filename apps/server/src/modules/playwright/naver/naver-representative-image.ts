import type { Page } from 'playwright';

import { humanClickLocatorFallback } from '../../human-engine/mouse.js';
import { humanSleep } from '../../human-engine/typing.js';
import { dismissSeOneMaterialPopup } from './naver-editor-locators.js';
import { logOperation } from '../../../lib/log-emitter.js';

const BODY_IMAGE_MODULE_SELECTOR =
  '.se-components-wrap .se-section-text:not(.se-section-documentTitle) .se-module-image, .se-components-wrap .se-section-text:not(.se-section-documentTitle) .se-component.se-image';

export async function isBlogRepresentativeImageSet(page: Page): Promise<boolean> {
  return page
    .evaluate(() => Boolean(document.querySelector('button.se-set-rep-image-button.se-is-selected')))
    .catch(() => false);
}

export async function countBodyImageModules(page: Page): Promise<number> {
  return page
    .evaluate((sel) => document.querySelectorAll(sel).length, BODY_IMAGE_MODULE_SELECTOR)
    .catch(() => 0);
}

async function clickBodyImageModule(page: Page, index: number): Promise<boolean> {
  const mod = page.locator(BODY_IMAGE_MODULE_SELECTOR).nth(index);
  if ((await mod.count().catch(() => 0)) === 0) return false;
  if (!(await mod.isVisible({ timeout: 3000 }).catch(() => false))) return false;

  await mod.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});

  const inner = mod.locator('img, .se-image, .se-image-resource').first();
  const target = (await inner.count().catch(() => 0)) > 0 ? inner : mod;
  if (!(await humanClickLocatorFallback(page, target, [90, 240]))) return false;

  await humanSleep(350, 650);
  return true;
}

/** 뷰포트 안의 대표 버튼 — 동일 클래스가 이미지마다 존재 */
async function clickVisibleRepresentativeButton(page: Page): Promise<boolean> {
  const buttons = page.locator('button.se-set-rep-image-button');
  const count = await buttons.count().catch(() => 0);
  const vpH = page.viewportSize()?.height ?? 9999;

  for (let i = 0; i < count; i += 1) {
    const btn = buttons.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;

    const box = await btn.boundingBox().catch(() => null);
    if (!box || box.width <= 4 || box.height <= 4 || box.y < 0 || box.y >= vpH) continue;

    const selected = await btn
      .evaluate((el) => el.classList.contains('se-is-selected'))
      .catch(() => false);
    if (selected) return true;

    if (await humanClickLocatorFallback(page, btn, [80, 200])) {
      await humanSleep(450, 900);
      return isBlogRepresentativeImageSet(page);
    }
  }

  return false;
}

/** 본문 이미지 모듈(0-based)을 네이버 블로그 대표이미지로 지정 */
export async function setBlogRepresentativeImage(
  page: Page,
  moduleIndex: number,
  accountId?: string,
): Promise<boolean> {
  if (moduleIndex < 0) return false;

  await dismissSeOneMaterialPopup(page);

  if (!(await clickBodyImageModule(page, moduleIndex))) {
    await logOperation({
      level: 'warn',
      message: `[post_blog][rep] 이미지 모듈 클릭 실패 (index=${moduleIndex})`,
      account_id: accountId,
    }).catch(() => {});
    return false;
  }

  await humanSleep(350, 700);
  const ok = await clickVisibleRepresentativeButton(page);

  await logOperation({
    level: ok ? 'info' : 'warn',
    message: ok
      ? `[post_blog][rep] 대표이미지 설정 완료 (module=${moduleIndex})`
      : `[post_blog][rep] 대표 버튼 클릭 실패 (module=${moduleIndex})`,
    account_id: accountId,
  }).catch(() => {});

  return ok;
}

/** 이미지 삽입 직후 — 방금 추가된 모듈을 대표로 지정 */
export async function setBlogRepresentativeAfterImageInsert(
  page: Page,
  imagePath: string,
  featuredImagePath: string | undefined,
  moduleIndexBeforeInsert: number,
  accountId?: string,
): Promise<void> {
  if (!featuredImagePath || imagePath !== featuredImagePath) return;
  const moduleIndex = moduleIndexBeforeInsert;
  await setBlogRepresentativeImage(page, moduleIndex, accountId);
}
