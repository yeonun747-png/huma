import type { Page, Locator } from 'playwright';
import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';
import { resolvePasteRatio } from '../../lib/settings.js';
import { humanSleep } from './typing.js';
import { humanTypeIntoElement, humanPasteIntoElement } from './korean-ime.js';
import { humanClickLocator } from './mouse.js';

export { humanSleep };

export async function scrollWithReverse(
  page: Page,
  durationMs: number,
  downRange: [number, number],
  pauseRange: [number, number],
  reverseProbability: number,
) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    if (Math.random() < reverseProbability) {
      await page.mouse.wheel(0, -randomBetween(80, 200));
      await sleep(randomBetween(500, 1500));
    } else {
      await page.mouse.wheel(0, randomBetween(downRange[0], downRange[1]));
    }
    await sleep(randomBetween(pauseRange[0], pauseRange[1]));
  }
}

export async function scrollReview(page: Page, durationMs: number) {
  await scrollWithReverse(page, durationMs, [80, 200], [800, 2500], 0.3);
}

export async function scrollRead(page: Page, durationMs: number) {
  await scrollWithReverse(page, durationMs, [100, 350], [1500, 4000], 0.15);
}

export async function measureRTT(proxyPort: number) {
  const { probeModemSocks } = await import('../../lib/modem-socks-probe.js');
  const probed = await probeModemSocks(proxyPort);
  return probed.ms ?? 3000;
}

export function rttScale(rtt: number): number {
  return Math.min(1 + rtt / 500, 2.5);
}

export async function scaledHumanSleep(minMs: number, maxMs: number, scale: number) {
  await humanSleep(Math.floor(minMs * scale), Math.floor(maxMs * scale));
}

export async function smartType(
  page: Page,
  element: Locator,
  text: string,
  humanConfig: HumanEngineConfig,
) {
  const paragraphs = text.split('\n\n');
  for (const para of paragraphs) {
    if (para.length > 0) {
      await humanTypeIntoElement(page, element, para, humanConfig);
    }
    await humanSleep(humanConfig.paragraph_pause_ms[0], humanConfig.paragraph_pause_ms[1]);
  }
}

/** v3.36 — 복붙 paste_ratio(기본55%) / IME 타이핑 */
export async function typePostContent(
  page: Page,
  element: Locator,
  content: string,
  humanConfig: HumanEngineConfig,
) {
  const { planParagraphPaste } = await import('@huma/shared');
  const paragraphs = content.split('\n\n').filter(Boolean);
  const total = paragraphs.length;
  if (total === 0) return;

  const pasteRatio = resolvePasteRatio(humanConfig);
  const pasteCount = Math.floor(total * pasteRatio);
  const pasteIndices = new Set<number>();
  while (pasteIndices.size < pasteCount) {
    pasteIndices.add(Math.floor(Math.random() * total));
  }

  for (let i = 0; i < total; i++) {
    const para = paragraphs[i]!;
    let focused = false;

    if (pasteIndices.has(i)) {
      const plan = planParagraphPaste(para);
      for (const seg of plan.segments) {
        if (seg.kind === 'paste') {
          await humanPasteIntoElement(page, element, seg.text);
          focused = true;
        } else {
          await humanTypeIntoElement(page, element, seg.text, humanConfig, { skipFocus: focused });
          focused = true;
        }
      }
    } else {
      await humanTypeIntoElement(page, element, para, humanConfig);
    }

    if (i < total - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await humanSleep(humanConfig.paragraph_pause_ms[0], humanConfig.paragraph_pause_ms[1]);
    }
  }
}

export { gaussianRandom, wpmToDelay };
