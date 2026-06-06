import type { FastifyInstance } from 'fastify';
import { crankLabelOf, crankServiceLabelKo, sortAccountsByCrankLabel } from '@huma/shared';
import { authMiddleware, supabase } from '../middleware/auth.js';
import { getSetting } from '../lib/settings.js';
import { formatKstHm } from '../lib/dashboard-period.js';
import type { CrankActivityType } from '../lib/crank-activity.js';
import {
  getCrankSchedulerStatus,
  runDailyCrankScheduler,
} from '../lib/crank-scheduler.js';

function normalizeFeedUrl(raw?: string | null): string | undefined {
  const u = raw?.trim();
  if (!u) return undefined;
  return u.startsWith('http://') || u.startsWith('https://') ? u : `https://${u}`;
}

/** Operation Log 전용 — 세션/IP·비행기모드 등 운영 메시지 */
const CRANK_SESSION_LOG = /^C-Rank (세션 시작|계정 전환)|^계정 전환 IP/;

function isCrankFeedActivity(
  meta: Record<string, unknown> | null,
  message: string,
): boolean {
  if (meta?.source === 'crank_session') return false;
  if (CRANK_SESSION_LOG.test(message)) return false;
  if (meta?.source === 'crank_activity') return true;
  const action = meta?.crank_action;
  if (action === '방문' || action === '공감' || action === '댓글' || action === '이웃') return true;
  return (
    message.startsWith('블로그 방문') ||
    message.startsWith('공감 —') ||
    message.startsWith('댓글 —') ||
    message.startsWith('이웃')
  );
}

function parseCrankAction(meta: Record<string, unknown> | null, message: string): CrankActivityType {
  const fromMeta = meta?.crank_action;
  if (fromMeta === '방문' || fromMeta === '공감' || fromMeta === '댓글' || fromMeta === '이웃') {
    return fromMeta;
  }
  if (message.includes('댓글') || message.includes('답글') || message.includes('카페')) return '댓글';
  if (message.includes('공감')) return '공감';
  if (message.includes('이웃')) return '이웃';
  return '방문';
}

export async function registerCrankRoutes(app: FastifyInstance) {
  app.get('/api/crank/feed', { preHandler: authMiddleware }, async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [{ data: activityLogs }, { data: cafePosts }, { data: crankAccounts }] = await Promise.all([
      supabase
        .from('huma_logs')
        .select('id, message, created_at, account_id, result_url, metadata, huma_accounts(name, crank_label)')
        .gte('created_at', todayIso)
        .eq('platform', 'naver_crank')
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('huma_cafe_viral_posts')
        .select('id, post_title, post_url, reply_posted, posted_at, created_at, huma_accounts(name, crank_label)')
        .not('reply_posted', 'is', null)
        .gte('posted_at', todayIso)
        .order('posted_at', { ascending: false })
        .limit(20),
      supabase
        .from('huma_accounts')
        .select('id, name, crank_label, crank_workspace, slot_label, crank_count_today, proxy_port, is_active')
        .eq('account_type', 'crank')
        .eq('is_active', true)
    ]);

    const kpiCounts = { visit: 0, like: 0, comment: 0, neighbor: 0 };
    const feed: Array<{
      id: string;
      acct: string;
      acctKey: string;
      acctId: string;
      type: CrankActivityType;
      title: string;
      sub: string;
      time: string;
      targetUrl?: string;
      expand?: string;
    }> = [];

    const acctKeyOf = (row: { name?: string; crank_label?: string | null } | null) =>
      crankLabelOf(row ?? {});

    for (const log of activityLogs ?? []) {
      const meta = (log.metadata as Record<string, unknown> | null) ?? null;
      const message = String(log.message ?? '');
      // 세션/IP·비행기모드 실패 등 운영 로그는 피드 행 자체를 내리지 않음 (Operation Log 전용)
      if (!isCrankFeedActivity(meta, message)) continue;

      const type = parseCrankAction(meta, message);
      if (type === '방문') kpiCounts.visit++;
      else if (type === '공감') kpiCounts.like++;
      else if (type === '댓글') kpiCounts.comment++;
      else kpiCounts.neighbor++;

      const acctRow = log.huma_accounts as { name?: string; crank_label?: string | null } | null;
      const acctKey = acctKeyOf(acctRow);
      const acctName = acctRow?.name ?? acctKey;
      const subMeta = typeof meta?.sub === 'string' ? meta.sub : '';
      const urlHint = log.result_url ? String(log.result_url).replace(/^https?:\/\//, '').slice(0, 40) : '';
      feed.push({
        id: `log-${log.id}`,
        acct: acctName,
        acctKey,
        acctId: acctKey,
        type,
        title: message.slice(0, 100),
        sub: subMeta || `${acctName} · ${urlHint || (formatKstHm(log.created_at) ?? '—')}`,
        time: formatKstHm(log.created_at) ?? '—',
        targetUrl: normalizeFeedUrl(log.result_url as string | null),
        expand: typeof meta?.comment === 'string' ? meta.comment : undefined,
      });
    }

    for (const post of cafePosts ?? []) {
      const acctRow = post.huma_accounts as { name?: string; crank_label?: string | null } | null;
      const acctKey = acctKeyOf(acctRow);
      const acct = acctRow?.name ?? acctKey;
      kpiCounts.comment++;
      feed.push({
        id: `cafe-${post.id}`,
        acct,
        acctKey,
        acctId: acctKey,
        type: '댓글',
        title: post.post_title ?? '카페 댓글',
        sub: `${acct} · ${String(post.post_url ?? '').replace(/^https?:\/\//, '').slice(0, 40)}`,
        time: formatKstHm(post.posted_at ?? post.created_at) ?? '—',
        targetUrl: normalizeFeedUrl(post.post_url as string | null),
        expand: post.reply_posted ? String(post.reply_posted) : undefined,
      });
    }

    feed.sort((a, b) => b.time.localeCompare(a.time));

    const config = await getSetting<Record<string, unknown>>('social_crank', {});
    const visitMax = Number(config.daily_visit_limit ?? 200);
    const accountCount = crankAccounts?.length ?? 0;
    const perAccount = Number(config.daily_limit_per_account ?? 30);

    const sortedCrankAccounts = sortAccountsByCrankLabel(crankAccounts ?? []);

    const accountCards = [
      {
        id: 'all',
        label: '전체',
        count: kpiCounts.visit,
        sub: `${accountCount}계정`,
      },
      ...sortedCrankAccounts.map((a) => {
        const key = crankLabelOf(a);
        return {
          id: key,
          label: key,
          displayName: a.name,
          count:
            feed.filter((f) => f.acctKey === key && f.type === '방문').length ||
            (a.crank_count_today ?? 0),
          sub:
            (a.crank_workspace ? crankServiceLabelKo(a.crank_workspace as 'yeonun' | 'panana' | 'quizoasis') : null) ??
            (a.name !== key ? a.name : a.proxy_port ? `:${a.proxy_port}` : '풀'),
        };
      }),
    ];

    return {
      kpi: {
        visit: { current: kpiCounts.visit, max: visitMax },
        like: { current: kpiCounts.like, max: Math.round(visitMax * 0.75) },
        comment: { current: kpiCounts.comment, max: Math.max(accountCount * 2, perAccount) },
        neighbor: { current: kpiCounts.neighbor, max: 20 },
      },
      accountCards,
      feed: feed.slice(0, 50),
      keywords: (() => {
        const pools = config.keyword_pools as Record<string, string[]> | undefined;
        if (pools && typeof pools === 'object') {
          return [...new Set(Object.values(pools).flat())].slice(0, 8);
        }
        return Array.isArray(config.keywords) ? (config.keywords as string[]).slice(0, 5) : [];
      })(),
      hasData: feed.length > 0 || accountCount > 0,
    };
  });

  app.get('/api/crank/scheduler', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const query = request.query as { probe?: string };
      const probe = query.probe === '1';
      return await getCrankSchedulerStatus({ probe });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  app.post('/api/crank/scheduler/run-today', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.admin?.isSuper) {
      return reply.code(403).send({ error: 'super admin만 실행 가능' });
    }
    await runDailyCrankScheduler();
    return getCrankSchedulerStatus({ probe: true });
  });
}
