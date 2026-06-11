/** 워밍업 종료 → 로그인 탭 전환 시 Chromium 생존 검증 */
import { config } from 'dotenv';
import {
  createBrowserForAccount,
  acquireWorkflowPage,
  releaseWorkflowPage,
} from '../dist/modules/playwright/browser.js';
import { loadAccountForBrowser } from '../dist/modules/playwright/account-loader.js';
import { preSessionWarmup } from '../dist/modules/playwright/naver/pre-session-warmup.js';

config();

const accountId = process.argv[2] ?? 'f73ccd82-ef59-468a-a8cf-809c1b3ee468';
const acct = await loadAccountForBrowser(accountId, 10006);
const { context } = await createBrowserForAccount(acct);
const warmupPage = await acquireWorkflowPage(context);
console.log('warmup start pages', context.pages().length);
await preSessionWarmup(warmupPage, acct.persona, 'crank', undefined, { express: true });
console.log('warmup done');
await releaseWorkflowPage(context, warmupPage);
console.log('after release pages', context.pages().length);
const next = await acquireWorkflowPage(context);
await next.goto('https://www.naver.com', { timeout: 45_000, waitUntil: 'domcontentloaded' });
console.log('post-warmup OK', await next.title());
await context.close();
