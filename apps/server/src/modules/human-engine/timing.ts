import type { Page, Locator } from 'playwright';
import { planParagraphPaste } from '@huma/shared';
import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';
import { probeModemSocks } from '../../lib/modem-socks-probe.js';
import { humanSleep, humanType } from './typing.js';

export async function scrollWithReverse(
  page: Page,
  durationMs: number,
  downRange: [number, number],
  pauseRange: [number, number],
  reverseProbability: number,
) {
  const start = Date.now();
  return (async () => {
    while (Date.now() - start < durationMs) {
      if (Math.random() < reverseProbability) {
        await page.mouse.wheel(0, -randomBetween(80, 200));
        await sleep(randomBetween(500, 1500));
      } else {
        await page.mouse.wheel(0, randomBetween(downRange[0], downRange[1]));
      }
      await sleep(randomBetween(pauseRange[0], pauseRange[1]));
    }
  })();
}

export async function scrollReview(page: Page, durationMs: number) {
  await scrollWithReverse(page, durationMs, [80, 200], [800, 2500], 0.3);
}

export async function scrollRead(page: Page, durationMs: number) {
  await scrollWithReverse(page, durationMs, [100, 350], [1500, 4000], 0.15);
}

export async function measureRTT(proxyPort: number): Promise<number> {
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
  humanConfig: HumanEngineConfig
) {
  const paragraphs = text.split('\n\n');

  for (const para of paragraphs) {
    if (para.length > 0) {
      await humanType(page, element, para, humanConfig);
    }
    await humanSleep(humanConfig.paragraph_pause_ms[0], humanConfig.paragraph_pause_ms[1]);
  }
}

/** v3.36 §8-1-2 — 복붙 30% / 직접 타이핑 70%, 단락 위치 매번 랜덤 */
export async function typePostContent(
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
          await element.click();
          await page.evaluate(async (text) => {
            await navigator.clipboard.writeText(text);
          }, seg.text);
          await page.keyboard.press('Control+V');
          await humanSleep(300, 800);
        } else {
          await humanType(page, element, seg.text, humanConfig);
        }
      }
    } else {
      await humanType(page, element, para, humanConfig);
    }

    if (i < total - 1) {
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await humanSleep(humanConfig.paragraph_pause_ms[0], humanConfig.paragraph_pause_ms[1]);
    }
  }
}

export { gaussianRandom, wpmToDelay };
