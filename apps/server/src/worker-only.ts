/**
 * v3.9 노트북 B — API 없이 BullMQ 워커만 실행
 * REDIS_HOST=노트북A_IP · HUMA_WORKER_ONLY=true
 */
import './lib/load-env.js';
import { startWorker } from './modules/queue/worker.js';

const concurrency = Number(process.env.HUMA_WORKER_CONCURRENCY) || 3;

startWorker(concurrency);
console.log(`HUMA Worker-only started (concurrency=${concurrency}, redis=${process.env.REDIS_URL ?? process.env.REDIS_HOST ?? 'localhost'})`);
