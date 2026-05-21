/**
 * v3.9 레거시 — v3.10은 단일 i7에서 index.js(API+Worker)만 사용.
 * 2대 분산 시: REDIS_HOST=마스터 IP · npm run start:worker
 */
import './lib/load-env.js';
import { startWorker } from './modules/queue/worker.js';

const concurrency = Number(process.env.HUMA_WORKER_CONCURRENCY) || 3;

startWorker(concurrency);
console.log(`HUMA Worker-only started (concurrency=${concurrency}, redis=${process.env.REDIS_URL ?? process.env.REDIS_HOST ?? 'localhost'})`);
