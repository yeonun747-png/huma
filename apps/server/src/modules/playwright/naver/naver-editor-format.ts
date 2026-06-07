import type { Locator, Page } from 'playwright';
import { planParagraphPaste } from '@huma/shared';

import type { HumanEngineConfig } from '../../../lib/settings.js';
import { humanSleep, humanType } from '../../human-engine/typing.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { clickEditorToolbar, editorFrame, findVisibleLocator } from './naver-editor-locators.js';

export type BoldSegment = { text: string; bold: boolean };

/** `**bold**` 구간 분리 (sanitize 시 preserveBold=true 전제) */
export function splitBoldSegments(text: string): BoldSegment[] {
  const segments: BoldSegment[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), bold: false });
    }
    segments.push({ text: match[1]!, bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), bold: false });
  }
  if (!segments.length) {
    segments.push({ text, bold: false });
  }
  return segments.filter((s) => s.text.length > 0);
}

/** 본문 글자 크기 — 기본 15pt */
export async function setBodyFontSize(page: Page, size = '15'): Promise<boolean> {
  const opened = await clickEditorToolbar(page, {
    dataNames: ['font-size', 'fontSize'],
    classHints: ['font-size', 'fontSize'],
    ariaLabels: ['글자 크기', '글자크기'],
    buttonTexts: ['글자'],
  });
  if (!opened) return false;

  await humanSleep(300, 700);

  const sizeSelectors = [
    `[data-font-size="${size}"]`,
    `button[data-value="${size}"]`,
    `.se-toolbar-option-font-size-${size}`,
    `button:has-text("${size}")`,
    `li:has-text("${size}")`,
  ];

  const option = await findVisibleLocator(page, sizeSelectors);
  if (option) {
    await humanClickLocator(page, option);
    await humanSleep(200, 500);
    return true;
  }

  // 드롭다운 닫기
  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

async function toggleBold(page: Page, on: boolean): Promise<boolean> {
  const frame = editorFrame(page);
  const activeSelectors = [
    '[data-name="bold"].se-is-selected',
    '[data-name="bold"].active',
    '.se-toolbar-item-bold.se-is-selected',
    'button[aria-pressed="true"][data-name="bold"]',
  ];

  let isOn = false;
  for (const sel of activeSelectors) {
    if ((await frame.locator(sel).count()) > 0) {
      isOn = true;
      break;
    }
  }

  if (isOn === on) return true;

  return clickEditorToolbar(page, {
    dataNames: ['bold'],
    classHints: ['toolbar-item-bold', 'bold'],
    ariaLabels: ['굵게', 'Bold'],
    buttonTexts: ['B'],
  });
}

async function typeSegments(
  page: Page,
  element: Locator,
  segments: BoldSegment[],
  humanConfig: HumanEngineConfig,
) {
  for (const seg of segments) {
    if (!seg.text) continue;
    if (seg.bold) {
      await toggleBold(page, true);
      await humanType(page, element, seg.text, humanConfig);
      await toggleBold(page, false);
    } else {
      await humanType(page, element, seg.text, humanConfig);
    }
  }
}

/** v3.36 — 복붙 30% / 타이핑 70% + **볼드** 툴바 적용 */
export async function typeNaverPostContent(
  page: Page,
  element: Locator,
  content: string,
  humanConfig: HumanEngineConfig,
) {
  const paragraphs = content.split('\n\n').filter(Boolean);
  const total = paragraphs.length;
  if (total === 0) return;

  const pasteCount = Math.floor(total * 0.3);
  const pasteIndices = new Set<number>();
  while (pasteIndices.size < pasteCount) {
    pasteIndices.add(Math.floor(Math.random() * total));
  }

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

  for (let i = 0; i < total; i++) {
    const para = paragraphs[i]!;

    if (pasteIndices.has(i)) {
      const plan = planParagraphPaste(para);
      for (const seg of plan.segments) {
        if (seg.kind === 'paste') {
          const plain = seg.text.replace(/\*\*([^*]+)\*\*/g, '$1');
          await humanClickLocator(page, element);
          await page.evaluate(async (text) => {
            await navigator.clipboard.writeText(text);
          }, plain);
          await page.keyboard.press('Control+V');
          await humanSleep(300, 800);
        } else {
          await typeSegments(page, element, splitBoldSegments(seg.text), humanConfig);
        }
      }
    } else {
      await typeSegments(page, element, splitBoldSegments(para), humanConfig);
    }

    if (i < total - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await humanSleep(humanConfig.paragraph_pause_ms[0], humanConfig.paragraph_pause_ms[1]);
    }
  }
}
