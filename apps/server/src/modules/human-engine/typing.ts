import type { Page, Locator } from 'playwright';
import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';

const ADJACENT: Record<string, string[]> = {
  a: ['s', 'q', 'w'], b: ['v', 'n', 'g'], c: ['x', 'v', 'd'],
  d: ['s', 'f', 'e'], e: ['w', 'r', 'd'], f: ['d', 'g', 'r'],
  g: ['f', 'h', 't'], h: ['g', 'j', 'y'], i: ['u', 'o', 'k'],
  j: ['h', 'k', 'u'], k: ['j', 'l', 'i'], l: ['k', 'o', 'p'],
  m: ['n', 'j', 'k'], n: ['b', 'm', 'h'], o: ['i', 'p', 'l'],
  p: ['o', 'l', '['], q: ['w', 'a', 's'], r: ['e', 't', 'f'],
  s: ['a', 'd', 'w'], t: ['r', 'y', 'g'], u: ['y', 'i', 'j'],
  v: ['c', 'b', 'f'], w: ['q', 'e', 's'], x: ['z', 'c', 's'],
  y: ['t', 'u', 'h'], z: ['x', 'a', 's'],
};

function getAdjacentKey(char: string): string {
  const lower = char.toLowerCase();
  const keys = ADJACENT[lower];
  if (!keys?.length) return char;
  return keys[Math.floor(Math.random() * keys.length)];
}

export async function humanType(
  page: Page,
  element: Locator,
  text: string,
  config: HumanEngineConfig
) {
  await element.click();
  for (const char of text) {
    if (Math.random() < config.typo_rate) {
      await element.pressSequentially(getAdjacentKey(char), { delay: 50 });
      await sleep(randomBetween(200, 500));
      await page.keyboard.press('Backspace');
      await sleep(randomBetween(...config.backspace_delay_ms));
    }
    await element.pressSequentially(char, { delay: 50 });
    await sleep(wpmToDelay(gaussianRandom(config.wpm_mean, config.wpm_sigma)));
  }
}

export async function humanSleep(minMs: number, maxMs: number) {
  await sleep(randomBetween(minMs, maxMs));
}
