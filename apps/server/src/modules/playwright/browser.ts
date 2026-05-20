import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

export async function createBrowser(proxyPort?: number) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  const proxy = proxyPort ? { server: `socks5://127.0.0.1:${proxyPort}` } : undefined;

  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args,
    proxy,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  return { browser, context };
}

export { chromium };
