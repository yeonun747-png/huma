import { config } from 'dotenv';
import { createBrowserForAccount, acquireWorkflowPage } from '../dist/modules/playwright/browser.js';
import { loadAccountForBrowser } from '../dist/modules/playwright/account-loader.js';

config();

const accountId = process.argv[2] ?? 'f73ccd82-ef59-468a-a8cf-809c1b3ee468';
const proxyPort = Number(process.argv[3] ?? 10006);

const acct = await loadAccountForBrowser(accountId, proxyPort);
const { context } = await createBrowserForAccount(acct);
console.log('pages after create', context.pages().length);
const page = await acquireWorkflowPage(context);
await page.goto('https://www.naver.com', { timeout: 45_000, waitUntil: 'domcontentloaded' });
console.log('FIX OK', await page.title());
await context.close();
