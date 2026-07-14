import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, requireSuper, supabase } from '../middleware/auth.js';
import { logOperation } from '../lib/log-emitter.js';
import { recoverCrankPipeline } from '../lib/crank-pipeline-recovery.js';
import { ensureTodayCrankQueue } from '../lib/crank-scheduler.js';
import { getSystemPaused, getSystemPauseState, setSystemPaused } from '../lib/system-pause.js';
import { disableAllAutoPublish, restoreAutoPublishFromSnapshot } from '../lib/auto-publish-state.js';
import { getCrankEnabled, getPostingEnabled } from '../lib/activity-control.js';
import {
  getActiveCaptchaDrillJobId,
  isCaptchaDrillEnabled,
  startCaptchaDrill,
} from '../modules/watcher/captcha-drill.js';
import { sendTelegramTest } from '../modules/watcher/telegram.js';
import { getVncRuntimeStatus } from '../modules/watcher/vnc-status.js';
import { resolveEarliestNextPublishAt } from '../lib/next-publish-schedule.js';
import { forceReleaseAllDongleLocks } from '../modules/proxy/manager.js';
import type { Workspace } from '@huma/shared';

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  }));

  app.get('/api/status', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace: workspaceQuery } = request.query as { workspace?: string };
    const workspaces =
      workspaceQuery && allowed.includes(workspaceQuery) ? [workspaceQuery] : allowed;
    const paused = getSystemPaused();

    const [
      { count: pendingJobs },
      { count: scheduledJobs },
      { count: runningJobs },
      { count: activeAccounts },
      { count: errors },
    ] = await Promise.all([
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'running'),
      supabase.from('huma_accounts').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('is_active', true),
      supabase.from('huma_logs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('level', 'ERROR').gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ]);

    const nextScheduled = await resolveEarliestNextPublishAt(workspaces);

    return {
      healthy: !paused,
      queueActive: !paused,
      running: !paused,
      pendingJobs: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      queued: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      liveAccounts: runningJobs ?? 0,
      nextScheduled,
      activeAccounts: activeAccounts ?? 0,
      errors: errors ?? 0,
      paused,
      crank_enabled: getCrankEnabled(),
      posting_enabled: getPostingEnabled(),
    };
  });

  app.post('/api/stop-all', { preHandler: [authMiddleware, requireSuper] }, async (request) => {
    const body = (request.body ?? {}) as { reason?: string };
    const reason = String(body.reason ?? '').trim() || '운영자 전체 정지';
    const autoPublishSnapshot = await disableAllAutoPublish();
    await setSystemPaused(true, { reason, autoPublishSnapshot });
    const dongleLocks = await forceReleaseAllDongleLocks();
    await logOperation({
      level: 'INFO',
      message: `HUMA 전체 정지 — ${reason} · 자동발행 ${autoPublishSnapshot.length}계정 OFF · 동글락 해제 Redis ${dongleLocks.redisKeysDeleted}·busy ${dongleLocks.busyCleared}`,
      metadata: {
        stop_reason: reason,
        auto_publish_off: autoPublishSnapshot.length,
        dongle_locks: dongleLocks,
      },
    });
    return {
      success: true,
      message: '전체 작업 중지됨',
      reason,
      auto_publish_disabled: autoPublishSnapshot.length,
      dongle_locks_released: dongleLocks,
    };
  });

  app.post('/api/resume-all', { preHandler: [authMiddleware, requireSuper] }, async () => {
    const pauseState = await getSystemPauseState();
    await setSystemPaused(false);
    const autoPublishRestored = await restoreAutoPublishFromSnapshot(
      pauseState.auto_publish_snapshot ?? [],
    );
    if (getCrankEnabled()) {
      await ensureTodayCrankQueue();
      await recoverCrankPipeline();
    }
    await logOperation({
      level: 'INFO',
      message: `HUMA 전체 재개 — C-Rank${getCrankEnabled() ? '·예약 큐 보정' : ' OFF'} · 포스팅${getPostingEnabled() ? ' ON' : ' OFF'} · 자동발행 ${autoPublishRestored}계정 복구`,
    });
    return { success: true, message: '작업 재개됨', auto_publish_restored: autoPublishRestored };
  });

  app.get('/api/system/captcha-drill', { preHandler: authMiddleware }, async () => ({
    enabled: isCaptchaDrillEnabled(),
    activeJobId: getActiveCaptchaDrillJobId(),
  }));

  app.post('/api/system/captcha-drill', { preHandler: authMiddleware }, async (request, reply) => {
    if (!isCaptchaDrillEnabled()) {
      return reply.code(403).send({ error: 'CAPTCHA 연습 비활성 (HUMA_CAPTCHA_DRILL=false)' });
    }
    const body = (request.body ?? {}) as { workspace?: string };
    const ws = body.workspace as Workspace | undefined;
    if (!ws || !['yeonun', 'panana', 'quizoasis'].includes(ws)) {
      return reply.code(400).send({ error: 'workspace: yeonun | panana | quizoasis' });
    }
    try {
      const result = await startCaptchaDrill(ws);
      return { success: true, ...result, queueUrl: `/queue?job=${result.jobId}` };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('CAPTCHA_DRILL_ALREADY_ACTIVE')) {
        return reply.code(409).send({ error: '이미 연습 진행 중', activeJobId: msg.split(':')[1] });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  app.post('/api/system/telegram-test', { preHandler: authMiddleware }, async (request, reply) => {
    const body = (request.body ?? {}) as { workspace?: string };
    const ws = body.workspace as Workspace | undefined;
    if (ws && !['yeonun', 'panana', 'quizoasis'].includes(ws)) {
      return reply.code(400).send({ error: 'workspace: yeonun | panana | quizoasis' });
    }
    try {
      const result = await sendTelegramTest(ws ?? 'yeonun');
      return { success: result.ok, ...result };
    } catch (err) {
      const msg = (err as Error).message;
      console.warn('[telegram-test]', msg);
      return {
        success: false,
        ok: false,
        chatId: null,
        error: msg,
        env: { hasToken: false, chatId: null, webUrl: false, vncUrl: false },
      };
    }
  });

  app.get('/api/system/vnc-status', { preHandler: authMiddleware }, async () => {
    const status = await getVncRuntimeStatus();
    return {
      ...status,
      drillActive: Boolean(getActiveCaptchaDrillJobId()),
    };
  });
}
