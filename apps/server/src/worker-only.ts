/**
 * v3.9 레거시 — v3.10은 단일 i7에서 index.js(API+Worker)만 사용.
 * 2대 분산 시: REDIS_HOST=마스터 IP · npm run start:worker
 */
import './lib/load-env.js';
import { initSystemPause } from './lib/system-pause.js';
import { startWorker } from './modules/queue/worker.js';
import { assertSecretsConfigured } from './lib/secrets.js';
import { reconcileStaleCrankModemLocks } from './modules/modem/allocation.js';
import { shutdownCaptchaHolds } from './modules/watcher/captcha-hold.js';

const concurrency = Number(process.env.HUMA_WORKER_CONCURRENCY) || 3;

assertSecretsConfigured();
await initSystemPause();
const worker = startWorker(concurrency);
console.log(`HUMA Worker-only started (concurrency=${concurrency}, redis=${process.env.REDIS_URL ?? process.env.REDIS_HOST ?? 'localhost'})`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} 수신 — worker graceful shutdown`);
  try {
    await worker.close();
    await shutdownCaptchaHolds();
    await reconcileStaleCrankModemLocks();
  } catch (err) {
    console.error('shutdown 오류:', (err as Error).message);
  }
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
