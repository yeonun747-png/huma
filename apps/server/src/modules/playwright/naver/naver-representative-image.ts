import type { Page } from 'playwright';

import { humanMouseMove } from '../../human-engine/mouse.js';
import { humanSleep } from '../../human-engine/typing.js';
import { sleep } from '../../../lib/utils.js';
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
  const clicked = await page
    .evaluate(
      ({ sel, idx }) => {
        const modules = Array.from(document.querySelectorAll(sel));
        const mod = modules[idx] as HTMLElement | undefined;
        if (!mod) return false;
        mod.scrollIntoView({ block: 'center', inline: 'nearest' });
        const target = (mod.querySelector('img, .se-image, .se-image-resource') ?? mod) as HTMLElement;
        target.click();
        return true;
      },
      { sel: BODY_IMAGE_MODULE_SELECTOR, idx: index },
    )
    .catch(() => false);

  if (!clicked) return false;
  await sleep(450);
  return true;
}

/** 뷰포트 안의 대표 버튼 — 동일 클래스가 이미지마다 존재 */
async function clickVisibleRepresentativeButton(page: Page): Promise<boolean> {
  const rect = await page
    .evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button.se-set-rep-image-button'));
      const visible = buttons.filter((btn) => {
        const r = btn.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && r.y >= 0 && r.y < window.innerHeight;
      });
      const target =
        visible.find((btn) => !btn.classList.contains('se-is-selected')) ??
        visible.find((btn) => btn.classList.contains('se-is-selected')) ??
        visible[visible.length - 1];
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, selected: target.classList.contains('se-is-selected') };
    })
    .catch(() => null);

  if (!rect) return false;
  if (rect.selected) return true;

  await humanMouseMove(page, rect.x + rect.w / 2, rect.y + rect.h / 2);
  await sleep(120);
  await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
  await humanSleep(450, 900);
  return isBlogRepresentativeImageSet(page);
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
