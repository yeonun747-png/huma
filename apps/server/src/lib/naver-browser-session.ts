import type { BrowserContext, Page } from 'playwright';

import { loadAccountForBrowser } from '../modules/playwright/account-loader.js';
import { createBrowserForAccount, closeBrowserContext } from '../modules/playwright/browser.js';
import { naverLogin } from '../modules/playwright/naver/login.js';
import { acquireModem, releaseModem, type ModemSession } from '../modules/proxy/manager.js';
import {
  reconnectModemIfAccountSwitched,
  recordLastAccountOnModem,
} from './modem-last-account.js';
import { assertNaverAutomationAllowed } from './account-guards.js';

export async function withNaverBrowserSession<T>(
  accountId: string,
  run: (ctx: { context: BrowserContext; page: Page }) => Promise<T>,
): Promise<T> {
  await assertNaverAutomationAllowed(accountId);

  let modemSession: ModemSession | undefined;
  try {
    modemSession = await acquireModem(accountId);
    if (!modemSession) throw new Error('NO_MODEM');

    await reconnectModemIfAccountSwitched(modemSession.proxyPort, accountId);
    const accountCtx = await loadAccountForBrowser(accountId, modemSession.proxyPort);
    // IP 소유권은 로그인/활동 전에 기록 — 중단돼도 다른 계정의 동일 IP 재사용 차단(규칙⑬).
    if (accountCtx.account_type === 'crank') {
      await recordLastAccountOnModem(modemSession.proxyPort, accountId);
    }
    const { context } = await createBrowserForAccount(accountCtx);

    try {
      await naverLogin(context, accountId, { profilePath: accountCtx.profile_path });
      const page = await context.newPage();
      const result = await run({ context, page });
      return result;
    } finally {
      await closeBrowserContext(context);
    }
  } finally {
    if (modemSession) await releaseModem(modemSession);
  }
}
