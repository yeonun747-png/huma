import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { getSetting } from '../lib/settings.js';
import { isDashboardPublishCountJob, isDashboardPublishListJob } from '@huma/shared';
import {
  buildChartBuckets,
  formatKstHm,
  formatKstYmdHm,
  getPeriodRange,
  kstDateKeyFromIso,
  kstDayStartIso,
  kstTodayStartIso,
  parseDashboardPeriod,
} from '../lib/dashboard-period.js';
import { buildContentPerformanceItems } from '../lib/content-performance.js';
import { resolveEarliestNextPublishAt } from '../lib/next-publish-schedule.js';
import {
  fetchSearchConsoleTopPages,
  getMissingSearchConsoleEnvKeys,
  isSearchConsoleConfigured,
} from '../modules/seo/search-console.js';
import type { Workspace } from '@huma/shared';

const WS_META: Record<Workspace, { icon: string; name: string }> = {
  yeonun: { icon: '🔮', name: '연운 緣運' },
  quizoasis: { icon: '🧠', name: '퀴즈오아시스' },
  panana: { icon: '🎬', name: '파나나' },
};

function mapJobStatus(status: string): {
  status: 'done' | 'running' | 'idle' | 'error' | 'warn';
  statusLabel: string;
  urlKind: 'link' | 'generating' | 'dash' | 'watcher';
} {
  if (status === 'completed') return { status: 'done', statusLabel: '완료', urlKind: 'link' };
  if (status === 'running') return { status: 'running', statusLabel: '발행중', urlKind: 'generating' };
  if (status === 'failed') return { status: 'error', statusLabel: '오류', urlKind: 'watcher' };
  if (status === 'paused') return { status: 'warn', statusLabel: '일시정지', urlKind: 'dash' };
  return { status: 'idle', statusLabel: '대기', urlKind: 'dash' };
}

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard/stats', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    const { period: periodRaw } = request.query as { period?: string };
    const period = parseDashboardPeriod(periodRaw);
    const range = getPeriodRange(period);
    const todayStart = kstTodayStartIso();
    const chartRangeStart = kstDayStartIso(6);
    const performanceRangeStart = new Date(Date.now() - 28 * 86400000).toISOString();

    const publishJobSelect =
      'completed_at, job_type, status, result_url, platform_schedule, link_url, content_type, title, workspace';

    const [
      { count: pendingJobs },
      { count: scheduledJobs },
      { count: activeAccounts },
      { count: totalAccounts },
      { count: periodErrors },
      { data: periodJobs },
      { data: prevPeriodJobs },
      { data: chartJobs },
      { data: performanceJobs },
      { data: workspaceJobRows },
      { data: crankAccounts },
      { data: postingAccounts },
      { data: platformAccounts },
    ] = await Promise.all([
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),
      supabase.from('huma_accounts').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('is_active', true),
      supabase.from('huma_accounts').select('*', { count: 'exact', head: true }).in('workspace', workspaces),
      supabase.from('huma_logs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('level', 'ERROR').gte('created_at', range.start).lte('created_at', range.end),
      supabase
        .from('huma_jobs')
        .select(publishJobSelect)
        .in('workspace', workspaces)
        .eq('status', 'completed')
        .gte('completed_at', range.start)
        .lte('completed_at', range.end),
      supabase
        .from('huma_jobs')
        .select(publishJobSelect)
        .in('workspace', workspaces)
        .eq('status', 'completed')
        .gte('completed_at', range.prevStart)
        .lte('completed_at', range.prevEnd),
      supabase
        .from('huma_jobs')
        .select(publishJobSelect)
        .in('workspace', workspaces)
        .eq('status', 'completed')
        .gte('completed_at', chartRangeStart),
      supabase
        .from('huma_jobs')
        .select(publishJobSelect)
        .in('workspace', workspaces)
        .eq('status', 'completed')
        .gte('completed_at', performanceRangeStart),
      supabase
        .from('huma_jobs')
        .select(
          'title, status, result_url, workspace, platform, account_id, job_type, link_url, content_type, platform_schedule, completed_at, huma_accounts(name)',
        )
        .in('workspace', workspaces)
        .eq('status', 'completed')
        .gte('completed_at', todayStart)
        .order('completed_at', { ascending: false })
        .limit(80),
      supabase.from('huma_accounts').select('crank_count_today, warmup_day, is_active').eq('account_type', 'crank').eq('is_active', true),
      supabase.from('huma_accounts').select('id, name, workspace').in('workspace', workspaces).eq('account_type', 'posting').eq('is_active', true),
      supabase.from('huma_platform_accounts').select('workspace, platform, username, is_active, post_count_today').in('workspace', workspaces),
    ]);

    const serviceStatsRaw = await Promise.all(
      workspaces.map(async (ws) => {
        const [{ count: pending }, { count: errCount }, { count: running }] = await Promise.all([
          supabase
            .from('huma_jobs')
            .select('*', { count: 'exact', head: true })
            .eq('workspace', ws)
            .in('status', ['pending', 'scheduled']),
          supabase
            .from('huma_logs')
            .select('*', { count: 'exact', head: true })
            .eq('workspace', ws)
            .eq('level', 'ERROR')
            .gte('created_at', todayStart),
          supabase
            .from('huma_jobs')
            .select('*', { count: 'exact', head: true })
            .eq('workspace', ws)
            .eq('status', 'running'),
        ]);
        return {
          workspace: ws,
          pending: pending ?? 0,
          errors: errCount ?? 0,
          running: running ?? 0,
        };
      }),
    );

    const periodPublishJobs = (periodJobs ?? []).filter(isDashboardPublishCountJob);
    const prevPublishJobs = (prevPeriodJobs ?? []).filter(isDashboardPublishCountJob);
    const chartPublishJobs = (chartJobs ?? []).filter(isDashboardPublishCountJob);
    const adjustedPeriodCompleted = periodPublishJobs.length;
    const adjustedPrevCompleted = prevPublishJobs.length;

    const serviceStats = workspaces.map((ws) => {
      const pending = serviceStatsRaw.find((s) => s.workspace === ws);
      const todayPublish = chartPublishJobs.filter(
        (j) => j.workspace === ws && j.completed_at && j.completed_at >= todayStart,
      ).length;
      return {
        workspace: ws,
        todayJobs: todayPublish,
        pending: pending?.pending ?? 0,
        errors: pending?.errors ?? 0,
        running: pending?.running ?? 0,
      };
    });

    const chartBuckets = buildChartBuckets(period);
    const chartMap: Record<string, number> = Object.fromEntries(chartBuckets.map((b) => [b.key, 0]));

    for (const j of chartPublishJobs) {
      if (!j.completed_at) continue;
      if (period === 'month') {
        const key = kstDateKeyFromIso(j.completed_at)?.slice(0, 7);
        if (key && key in chartMap) chartMap[key]++;
      } else {
        const key = kstDateKeyFromIso(j.completed_at);
        if (key && key in chartMap) chartMap[key]++;
      }
    }

    const crankConfig = await getSetting<Record<string, unknown>>('social_crank', {});
    const visitMax = Number(crankConfig.daily_visit_limit ?? 200);
    const visitCurrent = (crankAccounts ?? []).reduce((s, a) => s + (a.crank_count_today ?? 0), 0);
    const likeMax = Math.round(visitMax * 0.75);
    const commentMax = Math.round(visitMax * 0.25);
    const neighborMax = 20;

    const inactivePlatform = (platformAccounts ?? []).filter((p) => !p.is_active);
    const errorAccountName = inactivePlatform[0]?.username;

    const workspacePosts: Record<string, Array<Record<string, unknown>>> = {};
    for (const ws of workspaces) {
      workspacePosts[ws] = (workspaceJobRows ?? [])
        .filter((j) => j.workspace === ws && isDashboardPublishListJob(j))
        .slice(0, 5)
        .map((j) => {
          const mapped = mapJobStatus(j.status);
          const acct = j.huma_accounts as { name?: string } | null;
          const rawUrl = j.result_url?.trim() ?? '';
          const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : rawUrl ? `https://${rawUrl.replace(/^\/\//, '')}` : undefined;
          return {
            title: j.title ?? '제목 없음',
            meta: acct?.name ?? j.platform ?? ws,
            ...mapped,
            url,
          };
        });
    }

    const gscConfigured = workspaces.some((ws) => isSearchConsoleConfigured(ws));
    const roasMissingEnv = gscConfigured
      ? undefined
      : [...new Set(workspaces.flatMap((ws) => getMissingSearchConsoleEnvKeys(ws)))];

    let roasItems: ReturnType<typeof buildContentPerformanceItems> = [];
    if (gscConfigured) {
      const gscPagesByWorkspace = new Map<string, Awaited<ReturnType<typeof fetchSearchConsoleTopPages>>>();
      await Promise.all(
        workspaces.map(async (ws) => {
          if (!isSearchConsoleConfigured(ws)) return;
          try {
            gscPagesByWorkspace.set(ws, await fetchSearchConsoleTopPages(ws, 500));
          } catch {
            gscPagesByWorkspace.set(ws, []);
          }
        }),
      );
      roasItems = buildContentPerformanceItems(performanceJobs ?? [], gscPagesByWorkspace);
    }

    const roasMeta = {
      configured: gscConfigured,
      periodDays: 28,
      missingEnv: roasMissingEnv,
    };

    const publishDelta = adjustedPeriodCompleted - adjustedPrevCompleted;
    const deltaPrefix = publishDelta >= 0 ? '▲' : '▼';
    const periodSub =
      period === 'today'
        ? `${deltaPrefix} ${Math.abs(publishDelta)} 어제 대비`
        : period === 'week'
          ? '이번주 누적'
          : '이번달 누적';

    const serviceStatus = Object.fromEntries(
      serviceStats.map((s) => {
        const meta = WS_META[s.workspace as Workspace] ?? { icon: '◆', name: s.workspace };
        const postingCount = (postingAccounts ?? []).filter((a) => a.workspace === s.workspace).length;
        const wsInactive = (platformAccounts ?? []).filter((p) => p.workspace === s.workspace && !p.is_active);
        const status: 'ok' | 'warn' | 'err' =
          s.errors > 0 || wsInactive.length > 0 ? 'err' : s.pending > 5 ? 'warn' : 'ok';
        const detail =
          s.workspace === 'yeonun'
            ? `LIVE ${s.running} · IDLE ${s.pending} · 블로그 ${postingCount}계정`
            : s.workspace === 'panana' && wsInactive.length > 0
              ? `⚠ ERR · ${wsInactive[0].username} 세션 오류`
              : s.pending > 0
                ? `IDLE · 대기 ${s.pending}건`
                : '정상 가동';
        return [
          s.workspace,
          {
            icon: meta.icon,
            name: meta.name,
            detail,
            todayJobs: s.todayJobs,
            jobsLabel: status === 'err' ? '오류 발생' : '오늘 발행',
            status,
          },
        ];
      }),
    );

    const pananaTodayPosts = (platformAccounts ?? [])
      .filter((p) => p.workspace === 'panana')
      .reduce((s, p) => s + (p.post_count_today ?? 0), 0);

    const nextPublishAt = await resolveEarliestNextPublishAt(workspaces);

    return {
      pendingJobs: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      activeAccounts: activeAccounts ?? 0,
      errors: periodErrors ?? 0,
      todayCompleted: adjustedPeriodCompleted,
      serviceStats,
      chart: chartBuckets
        .filter((b) => b.key !== 'forecast')
        .map((b) => ({
          day: b.label,
          value: chartMap[b.key] ?? 0,
          isToday: b.isToday ?? false,
        })),
      chartAverage: (() => {
        const vals = chartBuckets.filter((b) => b.key !== 'forecast').map((b) => chartMap[b.key] ?? 0);
        if (vals.length === 0) return 0;
        return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
      })(),
      period,
      integrated: {
        todayPublish: adjustedPeriodCompleted,
        todayPublishSub: periodSub,
        queuePending: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
        queueSub: formatKstYmdHm(nextPublishAt)
          ? `다음 ${formatKstYmdHm(nextPublishAt)}`
          : '스케줄 없음',
        errors: periodErrors ?? 0,
        errorsSub: period === 'today' ? `Layer4·오류 ${periodErrors ?? 0}` : `${period === 'week' ? '주간' : '월간'} 오류 ${periodErrors ?? 0}`,
        activeAccounts: activeAccounts ?? 0,
        totalAccounts: totalAccounts ?? 0,
        accountSub: errorAccountName ? `⚠ ${errorAccountName} 세션오류 →` : `${activeAccounts ?? 0}개 활성`,
      },
      nextPublish: formatKstYmdHm(nextPublishAt),
      nextPublishAt,
      serviceStatus,
      workspacePosts,
      roasItems,
      roasMeta,
      yeonunSocial: [
        { label: '🤝 오늘 타 블로그 방문', current: visitCurrent, max: visitMax },
        { label: '❤ 공감 클릭', current: Math.round(visitCurrent * 0.62), max: likeMax },
        { label: '💬 AI 댓글 게시', current: Math.round(visitCurrent * 0.22), max: commentMax },
        { label: '👥 이웃 신청', current: Math.min(neighborMax, Math.round(visitCurrent * 0.08)), max: neighborMax },
        { label: '🏛 카페 소통', current: (crankAccounts ?? []).length, max: null },
      ],
      pananaStats: {
        todayPosts: pananaTodayPosts,
        activePlatforms: (platformAccounts ?? []).filter((p) => p.workspace === 'panana' && p.is_active).length,
        errorAccounts: inactivePlatform.filter((p) => p.workspace === 'panana').length,
      },
      chartLabel: period === 'today' ? '오늘 기준' : period === 'week' ? '이번주' : '이번달',
    };
  });

  app.get('/api/dashboard/recent', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_jobs')
      .select('title, status, result_url, workspace, completed_at')
      .in('workspace', workspaces)
      .order('created_at', { ascending: false })
      .limit(10);
    return data ?? [];
  });
}
