import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { formatKstHm } from '../lib/dashboard-period.js';
import { getCrankSessionProgress } from '../lib/crank-session-progress.js';

function estimatePostingProgress(content: string | null | undefined, wpm: number, startedAt: string | null) {
  const total = (content ?? '').length || 1200;
  const started = startedAt ? new Date(startedAt).getTime() : Date.now();
  const elapsedMin = Math.max(0, (Date.now() - started) / 60000);
  const chars = Math.min(total, Math.floor(elapsedMin * wpm));
  const remainingMin = wpm > 0 ? Math.ceil(Math.max(0, total - chars) / wpm) : 0;
  const etaDate = new Date(Date.now() + remainingMin * 60000);
  return {
    chars,
    totalChars: total,
    wpm,
    typos: Math.floor(chars / 280),
    eta: formatKstHm(etaDate.toISOString()) ?? '—',
    preview: (content ?? '').slice(0, 200),
  };
}

function elapsedMinutes(startedAt: string | null | undefined): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
}

export async function registerMonitorRoutes(app: FastifyInstance) {
  app.get('/api/monitor/sessions', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);

    const [
      { data: activeJobs },
      { data: nextScheduled },
      { data: inactivePlatforms },
      { data: failedJobs },
    ] = await Promise.all([
      supabase
        .from('huma_jobs')
        .select('id, title, job_type, workspace, platform, status, content, started_at, account_id, huma_accounts(name, wpm)')
        .in('workspace', workspaces)
        .in('status', ['running', 'awaiting_captcha'])
        .order('started_at', { ascending: false })
        .limit(6),
      supabase
        .from('huma_jobs')
        .select('id, title, job_type, workspace, platform, scheduled_at, huma_accounts(name)')
        .in('workspace', workspaces)
        .eq('status', 'scheduled')
        .not('scheduled_at', 'is', null)
        .gt('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('huma_platform_accounts')
        .select('id, workspace, platform, username, is_active, updated_at')
        .in('workspace', workspaces)
        .eq('is_active', false)
        .order('updated_at', { ascending: false })
        .limit(3),
      supabase
        .from('huma_jobs')
        .select('id, title, workspace, platform, error_message, completed_at, account_id, huma_accounts(name)')
        .in('workspace', workspaces)
        .eq('status', 'failed')
        .order('completed_at', { ascending: false })
        .limit(3),
    ]);

    const live = await Promise.all(
      (activeJobs ?? []).map(async (job) => {
        const acct = job.huma_accounts as { name?: string; wpm?: number } | null;
        const base = {
          jobId: job.id,
          account: acct?.name ?? '계정',
          platform: job.platform ?? job.workspace ?? 'naver',
          workspace: job.workspace,
          title: job.title ?? job.job_type,
          jobType: job.job_type,
          jobStatus: job.status,
          elapsedMin: elapsedMinutes(job.started_at),
        };

        if (job.job_type === 'social_crank') {
          const progress = await getCrankSessionProgress(job.id);
          const phase =
            job.status === 'awaiting_captcha'
              ? 'CAPTCHA 대기'
              : (progress?.phase ?? '진행 중');
          const detail = progress?.detail;
          return {
            ...base,
            kind: 'crank' as const,
            crankPhase: phase,
            crankDetail: detail,
            preview: detail ? `${phase} — ${detail}` : phase,
          };
        }

        const wpm = acct?.wpm ?? 52;
        const posting = estimatePostingProgress(job.content, wpm, job.started_at);
        return {
          ...base,
          kind: 'posting' as const,
          ...posting,
        };
      }),
    );

    const idle = nextScheduled
      ? {
          jobId: nextScheduled.id,
          account:
            (nextScheduled.huma_accounts as { name?: string } | null)?.name ?? '예약 작업',
          schedule: formatKstHm(nextScheduled.scheduled_at) ?? '—',
          title: nextScheduled.title ?? nextScheduled.job_type,
          workspace: nextScheduled.workspace,
          platform: nextScheduled.platform,
        }
      : null;

    const errors = [
      ...(inactivePlatforms ?? []).map((p) => ({
        kind: 'platform' as const,
        account: p.username,
        platform: p.platform,
        workspace: p.workspace,
        detail: `${p.platform} 계정 비활성`,
        sub: `${formatKstHm(p.updated_at) ?? '—'} · 재연결 필요`,
      })),
      ...(failedJobs ?? []).map((j) => ({
        kind: 'job' as const,
        account: (j.huma_accounts as { name?: string } | null)?.name ?? j.workspace,
        platform: j.platform ?? 'job',
        workspace: j.workspace,
        detail: j.error_message ?? '작업 실패',
        sub: `${formatKstHm(j.completed_at) ?? '—'} · ${j.title ?? '작업'}`,
      })),
    ].slice(0, 3);

    return { live, idle, errors };
  });
}
