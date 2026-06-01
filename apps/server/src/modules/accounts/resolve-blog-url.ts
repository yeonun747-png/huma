import { supabase } from '../../middleware/auth.js';
import { acquireAccount, releaseAccount } from '../../lib/account-lock.js';
import { logOperation } from '../../lib/log-emitter.js';
import { normalizeBlogUrl } from '../../lib/account-validation.js';
import { POSTING_PROXY_PORTS, isPostingProxyPort } from '../../lib/modem-ports.js';
import {
  closeBrowserContext,
  createBrowserForAccount,
} from '../playwright/browser.js';
import { loadAccountForBrowser } from '../playwright/account-loader.js';
import { naverLogin } from '../playwright/naver/login.js';
import { resolveNaverBlogUrl } from '../playwright/naver/resolve-blog-url.js';
import { getModemProxyPort, releaseModemLocks } from '../modem/allocation.js';
import { assertSocksProxyReady } from '../../lib/socks-proxy-check.js';

async function ensurePostingProxyPort(accountId: string, proxyPort?: number | null): Promise<number> {
  if (proxyPort && isPostingProxyPort(proxyPort)) {
    return proxyPort;
  }

  for (const port of POSTING_PROXY_PORTS) {
    const { data: occupant } = await supabase
      .from('huma_accounts')
      .select('id')
      .eq('proxy_port', port)
      .eq('account_type', 'posting')
      .neq('id', accountId)
      .maybeSingle();
    if (!occupant) {
      await supabase.from('huma_accounts').update({ proxy_port: port }).eq('id', accountId);
      return port;
    }
  }

  throw new Error('할당 가능한 포스팅 동글(10001~10004)이 없습니다.');
}

/** i7 동글 프록시 + Playwright로 로그인 후 blog_url DB 저장 (관리 PC 로그인 불필요) */
export async function runResolvePostingBlogUrl(accountId: string): Promise<{
  blog_url: string;
  proxy_port: number;
}> {
  if (!acquireAccount(accountId)) {
    throw new Error('ACCOUNT_BUSY');
  }

  let proxyPort = 0;
  try {
    const { data: row } = await supabase
      .from('huma_accounts')
      .select('id, account_type, naver_id, proxy_port, workspace')
      .eq('id', accountId)
      .single();

    if (!row) throw new Error('계정 없음');
    if (row.account_type !== 'posting') {
      throw new Error('포스팅 계정만 블로그 URL 자동 수집이 가능합니다.');
    }

    proxyPort = await ensurePostingProxyPort(accountId, row.proxy_port);
    proxyPort = await getModemProxyPort(accountId);
    await assertSocksProxyReady(proxyPort);
    const accountCtx = await loadAccountForBrowser(accountId, proxyPort);
    const { context } = await createBrowserForAccount(accountCtx);

    try {
      await naverLogin(context, accountId, {
        profilePath: accountCtx.profile_path,
        skipShadowWalk: true,
      });
      const page = await context.newPage();
      let blogUrl: string;
      try {
        blogUrl = await resolveNaverBlogUrl(page, row.naver_id);
      } finally {
        await page.close();
      }

      const normalized = normalizeBlogUrl(blogUrl);
      if (!normalized) throw new Error('BLOG_URL_NOT_FOUND');

      await supabase
        .from('huma_accounts')
        .update({ blog_url: normalized, proxy_port: proxyPort })
        .eq('id', accountId);

      await logOperation({
        level: 'info',
        message: `블로그 URL 자동 수집: ${normalized} (proxy :${proxyPort})`,
        workspace: row.workspace,
        account_id: accountId,
        result_url: normalized,
      });

      return { blog_url: normalized, proxy_port: proxyPort };
    } finally {
      await closeBrowserContext(context);
    }
  } finally {
    if (proxyPort) await releaseModemLocks(proxyPort, 'posting').catch(() => {});
    releaseAccount(accountId);
  }
}
