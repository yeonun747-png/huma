import type { BrowserContext } from 'playwright';
import { supabase } from '../../../middleware/auth.js';
import { decrypt } from '../../../lib/crypto.js';
import { humanSleep } from '../../human-engine/typing.js';
import { shadowWalk } from '../shadow-walk.js';
import { hasStoredSession } from '../account-loader.js';

const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login';
const NAV_TIMEOUT_MS = 60_000;

export async function naverLogin(
  context: BrowserContext,
  accountId: string,
  options?: { profilePath?: string; skipShadowWalk?: boolean; navTimeoutMs?: number }
) {
  const navTimeout = options?.navTimeoutMs ?? NAV_TIMEOUT_MS;

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('naver_id, naver_pw_enc, profile_path')
    .eq('id', accountId)
    .single();

  if (!account) throw new Error('계정 없음');

  const profilePath = options?.profilePath ?? account.profile_path;
  const hasSession = profilePath ? hasStoredSession(profilePath) : false;

  const page = await context.newPage();

  if (!hasSession && !options?.skipShadowWalk) {
    await shadowWalk(page);
  }

  await page.goto(NAVER_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  await page.waitForSelector('#id', { timeout: 30_000 });
  await humanSleep(1000, 2000);

  const password = decrypt(account.naver_pw_enc);
  await page.fill('#id', account.naver_id);
  await humanSleep(500, 1200);
  await page.fill('#pw', password);
  await humanSleep(800, 1500);
  await page.click('#log\\.login');
  await page
    .waitForURL((url) => !url.href.includes('nidlogin.login'), { timeout: navTimeout })
    .catch(() => page.waitForLoadState('domcontentloaded'));
  await humanSleep(2000, 4000);

  if (page.url().includes('captcha') || page.url().includes('challenge')) {
    await page.close();
    throw new Error('CAPTCHA_DETECTED');
  }

  await page.close();
}
