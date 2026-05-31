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

import { startWorker } from './modules/queue/worker.js';
import { recoverScheduledJobs } from './lib/job-scheduler.js';



const PORT = Number(process.env.PORT) || 3100;



async function main() {

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

  await app.listen({ port: PORT, host: '0.0.0.0' });



  const io = new Server(app.server, {

    cors: { origin: true },

    path: '/ws/logs',

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
    startWorker();
    await recoverScheduledJobs();
    app.log.info('BullMQ worker started');

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


