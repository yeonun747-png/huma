import type { BrowserContext, Page } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { acquireAccount, releaseAccount } from './account-lock.js';
import { logOperation } from './log-emitter.js';
import { loadAccountForBrowser } from '../modules/playwright/account-loader.js';
import { closeBrowserContext, createBrowserForAccount } from '../modules/playwright/browser.js';
import { acquireModem, releaseModem, type ModemSession } from '../modules/proxy/manager.js';
import { enforceVncWindowBounds } from './vnc-window-guard.js';
import { setVncFocusPort } from './vnc-tile-state.js';
import { vncSlotLabelKo } from './vnc-window-layout.js';
import { resolveVncUrl } from '../modules/watcher/telegram.js';

const NAVER_HOME = 'https://www.naver.com';
const REMOTE_ACCESS_TIMEOUT_MS = 30 * 60 * 1000;

interface RemoteAccessEntry {
  accountId: string;
  accountName: string;
  workspace: string | null;
  context: BrowserContext;
  modemSession: ModemSession;
  page: Page;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, RemoteAccessEntry>();

function sessionAlive(entry: RemoteAccessEntry): boolean {
  try {
    return entry.context.pages().some((p) => !p.isClosed());
  } catch {
    return false;
  }
}

function resetTimer(accountId: string): void {
  const entry = sessions.get(accountId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void cleanupEntry(accountId), REMOTE_ACCESS_TIMEOUT_MS);
}

async function cleanupEntry(accountId: string): Promise<void> {
  const entry = sessions.get(accountId);
  if (!entry) return;
  sessions.delete(accountId);
  clearTimeout(entry.timer);
  await closeBrowserContext(entry.context).catch(() => {});
  await releaseModem(entry.modemSession).catch(() => {});
  await releaseAccount(accountId).catch(() => {});
}

async function focusSession(entry: RemoteAccessEntry): Promise<void> {
  if (!entry.page.isClosed()) {
    await entry.page.bringToFront().catch(() => {});
    if (!/naver\.com/i.test(entry.page.url())) {
      await entry.page
        .goto(NAVER_HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        .catch(() => {});
    }
  }
  await setVncFocusPort(entry.modemSession.proxyPort);
  await enforceVncWindowBounds(entry.context, entry.modemSession.proxyPort, false).catch(() => {});
}

/** 포스팅 계정 — 해당 동글 IP·VNC에서 naver.com만 열어 수동 설정 */
export async function startPostingRemoteAccess(accountId: string): Promise<{
  ok: true;
  accountId: string;
  accountName: string;
  proxyPort: number;
  slotLabel: string | null;
  vncUrl: string | null;
  reused: boolean;
}> {
  const existing = sessions.get(accountId);
  if (existing && sessionAlive(existing)) {
    await focusSession(existing);
    resetTimer(accountId);
    return {
      ok: true,
      accountId,
      accountName: existing.accountName,
      proxyPort: existing.modemSession.proxyPort,
      slotLabel: vncSlotLabelKo(existing.modemSession.proxyPort),
      vncUrl: resolveVncUrl(existing.workspace),
      reused: true,
    };
  }
  if (existing) await cleanupEntry(accountId);

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('id, name, account_type, workspace, proxy_port, is_active')
    .eq('id', accountId)
    .maybeSingle();

  if (!account) throw new Error('ACCOUNT_NOT_FOUND');
  if (account.account_type !== 'posting') throw new Error('POSTING_ACCOUNT_ONLY');
  if (account.is_active === false) throw new Error('ACCOUNT_INACTIVE');
  if (!account.proxy_port) throw new Error('PROXY_PORT_MISSING');

  if (!(await acquireAccount(accountId))) throw new Error('ACCOUNT_BUSY');

  let modemSession: ModemSession | undefined;
  try {
    modemSession = await acquireModem(accountId);
    if (!modemSession) throw new Error('NO_MODEM');

    const accountCtx = await loadAccountForBrowser(accountId, modemSession.proxyPort);
    const { context } = await createBrowserForAccount(accountCtx);

    const pages = [...context.pages()];
    const page = pages[0] ?? (await context.newPage());
    for (const p of pages.slice(1)) {
      await p.close().catch(() => {});
    }

    await page.goto(NAVER_HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.bringToFront().catch(() => {});
    await setVncFocusPort(modemSession.proxyPort);
    await enforceVncWindowBounds(context, modemSession.proxyPort, false).catch(() => {});

    const workspace = (account.workspace as string | null) ?? null;
    const timer = setTimeout(() => void cleanupEntry(accountId), REMOTE_ACCESS_TIMEOUT_MS);
    context.on('close', () => void cleanupEntry(accountId));

    sessions.set(accountId, {
      accountId,
      accountName: account.name as string,
      workspace,
      context,
      modemSession,
      page,
      timer,
    });

    await logOperation({
      level: 'info',
      message: '[accounts] 포스팅 원격접속 — naver.com',
      account_id: accountId,
    });

    return {
      ok: true,
      accountId,
      accountName: account.name as string,
      proxyPort: modemSession.proxyPort,
      slotLabel: vncSlotLabelKo(modemSession.proxyPort),
      vncUrl: resolveVncUrl(workspace),
      reused: false,
    };
  } catch (err) {
    if (modemSession) await releaseModem(modemSession).catch(() => {});
    await releaseAccount(accountId).catch(() => {});
    throw err;
  }
}

export async function stopPostingRemoteAccess(accountId: string): Promise<boolean> {
  if (!sessions.has(accountId)) return false;
  await cleanupEntry(accountId);
  return true;
}
