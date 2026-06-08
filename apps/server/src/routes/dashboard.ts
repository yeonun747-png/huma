import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { getSetting } from '../lib/settings.js';
import {
  buildChartBuckets,
  formatKstHm,
  formatKstYmdHm,
  getPeriodRange,
  parseDashboardPeriod,
} from '../lib/dashboard-period.js';
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      { count: pendingJobs },
      { count: scheduledJobs },
      { count: activeAccounts },
      { count: totalAccounts },
      { count: periodErrors },
      { count: periodCompleted },
      { count: prevCompleted },
      { data: nextScheduled },
      { data: periodJobs },
      { data: recentCompleted },
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
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'completed').gte('completed_at', range.start).lte('completed_at', range.end),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'completed').gte('completed_at', range.prevStart).lte('completed_at', range.prevEnd),
      supabase
        .from('huma_jobs')
        .select('scheduled_at')
        .in('workspace', workspaces)
        .in('status', ['pending', 'scheduled'])
        .not('scheduled_at', 'is', null)
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('huma_jobs')
        .select('completed_at')
        .in('workspace', workspaces)
        .eq('status', 'completed')
        .gte('completed_at', range.start)
        .lte('completed_at', range.end),
      supabase
        .from('huma_jobs')
        .select('title, platform, content, completed_at, workspace')
        .in('workspace', workspaces)
        .eq('status', 'completed')
        .gte('completed_at', range.start)
        .order('completed_at', { ascending: false })
        .limit(20),
      supabase
        .from('huma_jobs')
        .select('title, status, result_url, workspace, platform, account_id, huma_accounts(name)')
        .in('workspace', workspaces)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('huma_accounts').select('crank_count_today, warmup_day, is_active').eq('account_type', 'crank').eq('is_active', true),
      supabase.from('huma_accounts').select('id, name, workspace').in('workspace', workspaces).eq('account_type', 'posting').eq('is_active', true),
      supabase.from('huma_platform_accounts').select('workspace, platform, username, is_active, post_count_today').in('workspace', workspaces),
    ]);

    const serviceStats = await Promise.all(
      workspaces.map(async (ws) => {
        const [{ count: jobs }, { count: pending }, { count: errCount }, { count: running }] = await Promise.all([
          supabase
            .from('huma_jobs')
            .select('*', { count: 'exact', head: true })
            .eq('workspace', ws)
            .eq('status', 'completed')
            .gte('completed_at', todayStart.toISOString()),
          supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).eq('workspace', ws).in('status', ['pending', 'scheduled']),
          supabase
            .from('huma_logs')
            .select('*', { count: 'exact', head: true })
            .eq('workspace', ws)
            .eq('level', 'ERROR')
            .gte('created_at', todayStart.toISOString()),
          supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).eq('workspace', ws).eq('status', 'running'),
        ]);
        return { workspace: ws, todayJobs: jobs ?? 0, pending: pending ?? 0, errors: errCount ?? 0, running: running ?? 0 };
      }),
    );

    const chartBuckets = buildChartBuckets(period);
    const chartMap: Record<string, number> = Object.fromEntries(chartBuckets.map((b) => [b.key, 0]));

    for (const j of periodJobs ?? []) {
      if (!j.completed_at) continue;
      if (period === 'month') {
        const key = j.completed_at.slice(0, 7);
        if (key in chartMap) chartMap[key]++;
      } else {
        const key = j.completed_at.slice(0, 10);
        if (key in chartMap) chartMap[key]++;
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
        .filter((j) => j.workspace === ws)
        .slice(0, 5)
        .map((j) => {
          const mapped = mapJobStatus(j.status);
          const acct = j.huma_accounts as { name?: string } | null;
          return {
            title: j.title ?? '제목 없음',
            meta: acct?.name ?? j.platform ?? ws,
            ...mapped,
            url: j.result_url ?? undefined,
          };
        });
    }

    const roasItems = (recentCompleted ?? [])
      .map((j) => ({
        title: j.title ?? '콘텐츠',
        platform: j.platform ?? j.workspace ?? 'naver',
        views: Math.max(100, (j.content ?? '').length * 3),
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);

    const publishDelta = (periodCompleted ?? 0) - (prevCompleted ?? 0);
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

    return {
      pendingJobs: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      activeAccounts: activeAccounts ?? 0,
      errors: periodErrors ?? 0,
      todayCompleted: periodCompleted ?? 0,
      serviceStats,
      chart: chartBuckets
        .filter((b) => b.key !== 'forecast')
        .map((b) => ({ day: b.label, value: chartMap[b.key] ?? 0 })),
      period,
      integrated: {
        todayPublish: periodCompleted ?? 0,
        todayPublishSub: periodSub,
        queuePending: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
        queueSub: formatKstYmdHm(nextScheduled?.scheduled_at)
          ? `다음 ${formatKstYmdHm(nextScheduled?.scheduled_at)}`
          : '스케줄 없음',
        errors: periodErrors ?? 0,
        errorsSub: period === 'today' ? `Layer4·오류 ${periodErrors ?? 0}` : `${period === 'week' ? '주간' : '월간'} 오류 ${periodErrors ?? 0}`,
        activeAccounts: activeAccounts ?? 0,
        totalAccounts: totalAccounts ?? 0,
        accountSub: errorAccountName ? `⚠ ${errorAccountName} 세션오류 →` : `${activeAccounts ?? 0}개 활성`,
      },
      nextPublish: formatKstYmdHm(nextScheduled?.scheduled_at),
      nextPublishAt: nextScheduled?.scheduled_at ?? null,
      serviceStatus,
      workspacePosts,
      roasItems,
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
