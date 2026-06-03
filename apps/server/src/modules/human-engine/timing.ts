import type { Page, Locator } from 'playwright';
import axios from 'axios';
import { gaussianRandom, randomBetween, sleep, wpmToDelay } from '../../lib/utils.js';
import type { HumanEngineConfig } from '../../lib/settings.js';
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
  const probed = await probeProxyHealth(proxyPort);
  return probed.ms ?? 3000;
}

const PROBE_FAIL = { ok: false, ms: null } as const;

async function probeProxyHealthOnce(
  proxyPort: number,
  timeoutMs: number,
): Promise<{ ok: boolean; ms: number | null }> {
  const start = Date.now();
  try {
    const res = await axios.get('https://www.naver.com', {
      proxy: { host: '127.0.0.1', port: proxyPort, protocol: 'socks5' },
      timeout: timeoutMs,
      validateStatus: (s) => s < 500,
    });
    if (res.status >= 400) return PROBE_FAIL;
    return { ok: true, ms: Date.now() - start };
  } catch {
    return PROBE_FAIL;
  }
}

/** SOCKS 프록시 실제 응답 여부 (모뎀 대시보드 probe용) */
export async function probeProxyHealth(
  proxyPort: number,
  timeoutMs = 8000,
): Promise<{ ok: boolean; ms: number | null }> {
  const hardMs = timeoutMs + 1500;
  return Promise.race([
    probeProxyHealthOnce(proxyPort, timeoutMs),
    new Promise<{ ok: boolean; ms: number | null }>((resolve) =>
      setTimeout(() => resolve(PROBE_FAIL), hardMs),
    ),
  ]);
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

export { gaussianRandom, wpmToDelay };
