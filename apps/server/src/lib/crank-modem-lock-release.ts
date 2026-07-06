import { supabase } from '../middleware/auth.js';
import { redisConnection } from '../modules/queue/producer.js';
import { releaseModemLocks } from '../modules/modem/allocation.js';
import { clearInProcessModemBusy } from '../modules/proxy/manager.js';
import { CRANK_PROXY_PORTS } from './modem-ports.js';
import { getSchedulableCrankProxyPorts } from './crank-modems.js';
import { proxyPortForCrankTrack } from './crank-schedule-config.js';
import { logOperation } from './log-emitter.js';

function crankLockKey(port: number): string {
  return `modem_lock:${port}`;
}

async function hasOtherRunningCrankJob(
  accountId: string,
  excludeJobId?: string,
): Promise<boolean> {
  let q = supabase
    .from('huma_jobs')
    .select('id')
    .eq('job_type', 'social_crank')
    .eq('status', 'running')
    .eq('account_id', accountId)
    .limit(1);
  if (excludeJobId) q = q.neq('id', excludeJobId);
  const { data } = await q.maybeSingle();
  return Boolean(data);
}

function parseCrankJobPorts(content: unknown): number[] {
  const ports = new Set<number>();
  try {
    const payload = JSON.parse(String(content ?? '{}')) as {
      preferredProxyPort?: number;
      crankTrack?: number;
    };
    if (typeof payload.preferredProxyPort === 'number') {
      ports.add(payload.preferredProxyPort);
    } else if (typeof payload.crankTrack === 'number') {
      ports.add(proxyPortForCrankTrack(payload.crankTrack));
    }
  } catch {
    /* ignore */
  }
  return [...ports];
}

/**
 * C-Rank job 재예약·실패(오류 표시) 시 해당 실폰 Redis crank lock 해제.
 * 다른 계정 LIVE 세션이 같은 포트를 쓰는 중이면 건너뜀.
 */
export async function releaseCrankModemLockForJob(opts: {
  humaJobId?: string;
  accountId?: string | null;
}): Promise<number> {
  const { humaJobId } = opts;
  let accountId = opts.accountId ?? null;
  let preferredPorts: number[] = [];

  if (humaJobId) {
    const { data: job } = await supabase
      .from('huma_jobs')
      .select('job_type, content, account_id')
      .eq('id', humaJobId)
      .maybeSingle();
    if (!job || job.job_type !== 'social_crank') return 0;
    accountId = accountId ?? (job.account_id as string | null);
    preferredPorts = parseCrankJobPorts(job.content);
  }

  if (accountId && (await hasOtherRunningCrankJob(accountId, humaJobId))) {
    return 0;
  }

  const schedulable = await getSchedulableCrankProxyPorts();
  const pool = schedulable.length > 0 ? schedulable : [...CRANK_PROXY_PORTS];
  const portsToScan =
    preferredPorts.length > 0
      ? preferredPorts.filter((p) => pool.includes(p))
      : pool;

  let released = 0;
  for (const port of portsToScan) {
    const holder = await redisConnection.get(crankLockKey(port));
    if (!holder) continue;
    if (accountId && holder !== accountId) continue;
    if (await hasOtherRunningCrankJob(holder, humaJobId)) continue;

    await releaseModemLocks(port, 'crank');
    clearInProcessModemBusy(port);
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('proxy_port', port)
      .in('status', ['busy', 'reconnecting']);
    released++;
    await logOperation({
      level: 'info',
      message: `[crank] 큐 오류·재예약 — 실폰 lock 해제 :${port} (holder=${holder})`,
      job_id: humaJobId,
      account_id: accountId ?? holder,
    });
  }

  return released;
}
