import type { Page, Locator } from 'playwright';
import axios from 'axios';
import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';
import { humanSleep, humanType } from './typing.js';

export async function scrollReview(page: Page, durationMs: number) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    await page.mouse.wheel(0, randomBetween(80, 200));
    await sleep(randomBetween(800, 2500));
  }
}

export async function scrollRead(page: Page, durationMs: number) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    await page.mouse.wheel(0, randomBetween(100, 350));
    await sleep(randomBetween(1500, 4000));
    if (Math.random() < 0.15) {
      await page.mouse.wheel(0, -randomBetween(50, 150));
      await sleep(randomBetween(500, 1500));
    }
  }
}

export async function measureRTT(proxyPort: number): Promise<number> {
  const start = Date.now();
  await axios
    .get('https://www.naver.com', {
      proxy: { host: '127.0.0.1', port: proxyPort, protocol: 'socks5' },
      timeout: 5000,
    })
    .catch(() => {});
  return Math.min(Date.now() - start, 3000);
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
  await element.click();
  const paragraphs = text.split('\n\n');

  for (const para of paragraphs) {
    if (Math.random() < 0.3 && para.length > 50) {
      await page.evaluate((t) => navigator.clipboard.writeText(t), para);
      await humanSleep(200, 600);
      await element.click();
      await page.keyboard.press('Control+V');
      await humanSleep(300, 800);
    } else {
      await humanType(page, element, para, humanConfig);
    }
    await humanSleep(humanConfig.paragraph_pause_ms[0], humanConfig.paragraph_pause_ms[1]);
  }
}

export { gaussianRandom, wpmToDelay };
