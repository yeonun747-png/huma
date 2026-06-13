import './lib/load-env.js';

import Fastify from 'fastify';

import cors from '@fastify/cors';

import { Server } from 'socket.io';

import { registerAuthRoutes } from './routes/auth.js';

import { registerSystemRoutes } from './routes/system.js';

import { registerJobRoutes } from './routes/jobs.js';

import { registerAccountRoutes } from './routes/accounts.js';

import { registerModemRoutes } from './routes/modems.js';

import { registerLogRoutes } from './routes/logs.js';

import { registerVideoRoutes } from './routes/video.js';

import { registerSettingsRoutes } from './routes/settings.js';

import { registerPlatformAccountRoutes } from './routes/platform-accounts.js';

import { registerCafeRoutes } from './routes/cafe.js';
import { registerCafeViralRoutes } from './routes/cafe-viral.js';

import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerAdSenseRoutes } from './routes/adsense.js';
import { getMissingAdSenseEnvKeys, isAdSenseConfigured } from './modules/adsense/client.js';

import { setLogSocket } from './lib/log-emitter.js';
import { verifyAdminToken } from './middleware/auth.js';

import { startWorker } from './modules/queue/worker.js';
import { initSystemPause, getSystemPaused } from './lib/system-pause.js';
import { initActivityControl } from './lib/activity-control.js';
import { recoverCrankPipeline } from './lib/crank-pipeline-recovery.js';
import { reconcileStaleCrankModemLocks } from './modules/modem/allocation.js';
import { shutdownCaptchaHolds } from './modules/watcher/captcha-hold.js';
import {
  startTelegramCaptchaInbound,
  stopTelegramCaptchaInbound,
} from './modules/watcher/telegram-captcha-inbound.js';
import { startCrankScheduler } from './lib/crank-scheduler.js';
import { startCafeActivityScheduler } from './lib/cafe-activity-scheduler.js';
import { registerCrankRoutes } from './routes/crank.js';
import { registerMonitorRoutes } from './routes/monitor.js';
import { registerVncRoutes } from './routes/vnc.js';
import { registerSeoRoutes } from './routes/seo.js';
import { assertSecretsConfigured } from './lib/secrets.js';



const PORT = Number(process.env.PORT) || 3100;

let shuttingDown = false;

function registerGracefulShutdown(
  app: ReturnType<typeof Fastify>,
  worker: ReturnType<typeof startWorker>,
) {
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.warn(`${signal} 수신 — graceful shutdown 시작`);
    try {
      await worker.close();
      stopTelegramCaptchaInbound();
      await shutdownCaptchaHolds();
      await reconcileStaleCrankModemLocks();
    } catch (err) {
      app.log.error('shutdown 정리 중 오류: %s', (err as Error).message);
    }
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

async function main() {

  assertSecretsConfigured();

  const app = Fastify({ logger: true });



  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-HUMA-KEY'],
  });



  await registerAuthRoutes(app);

  await registerSystemRoutes(app);

  await registerJobRoutes(app);

  await registerAccountRoutes(app);

  await registerModemRoutes(app);

  await registerLogRoutes(app);

  await registerVideoRoutes(app);

  await registerSettingsRoutes(app);

  await registerPlatformAccountRoutes(app);

  await registerCafeRoutes(app);

  await registerCafeViralRoutes(app);

  await registerDashboardRoutes(app);
  await registerAdSenseRoutes(app);
  await registerCrankRoutes(app);
  await registerMonitorRoutes(app);
  await registerVncRoutes(app);
  await registerSeoRoutes(app);

  await app.listen({ port: PORT, host: '0.0.0.0' });



  const io = new Server(app.server, {

    cors: { origin: true },

    path: '/ws/logs',

  });



  io.use((socket, next) => {

    const token =

      (socket.handshake.auth?.token as string | undefined) ??

      (socket.handshake.query?.token as string | undefined) ??

      (socket.handshake.headers['x-huma-key'] as string | undefined);

    const admin = verifyAdminToken(token);

    if (!admin) {

      next(new Error('인증 필요'));

      return;

    }

    socket.data.admin = admin;

    next();

  });



  setLogSocket(io);



  io.on('connection', (socket) => {

    socket.emit('log', {

      level: 'info',

      message: 'WebSocket 연결됨',

      created_at: new Date().toISOString(),

    });

  });



  try {
    await initSystemPause();
    await initActivityControl();
    if (process.platform === 'linux' && process.env.DISPLAY === ':99') {
      const { spawn } = await import('node:child_process');
      const { fileURLToPath } = await import('node:url');
      const { dirname, join } = await import('node:path');
      const deployRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy');
      spawn('bash', [join(deployRoot, 'scripts', 'start-fcitx-xvfb.sh')], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
    if (getSystemPaused()) {
      app.log.warn('HUMA 전체 정지 상태 — ▶ 재시작 전까지 큐·스케줄러 가동 안 함');
    }
    const worker = startWorker();
    startTelegramCaptchaInbound();
    await recoverCrankPipeline();
    startCrankScheduler();
    startCafeActivityScheduler();
    app.log.info('BullMQ worker + crank scheduler + cafe activity scheduler started');

    registerGracefulShutdown(app, worker);

  } catch (err) {

    app.log.warn('BullMQ worker failed to start (Redis 필요): %s', (err as Error).message);

  }



  app.log.info(`HUMA Server running on http://localhost:${PORT}`);
  const adsenseOk = isAdSenseConfigured('quizoasis');
  const adsenseMissing = getMissingAdSenseEnvKeys('quizoasis');
  app.log.info(
    adsenseOk
      ? 'AdSense API: configured (quizoasis)'
      : `AdSense API: NOT configured — missing: ${adsenseMissing.join(', ') || '(unknown)'}`,
  );
}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


