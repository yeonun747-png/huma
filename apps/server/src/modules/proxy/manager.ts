import { supabase } from '../../middleware/auth.js';
import { redisConnection } from '../queue/producer.js';
import { CRANK_PROXY_PORTS, POSTING_PROXY_PORTS } from '../../lib/modem-ports.js';
import { getModemProxyPort, releaseModemLocks } from '../modem/allocation.js';
import { logOperation } from '../../lib/log-emitter.js';

/** 프로세스 내 동시 점유 — 규칙 ⑬: 동일 슬롯 2계정 금지 */
const busyModems = new Set<string>();

function postingLockKey(port: number) {
  return `modem_lock:posting:${port}`;
}

function crankLockKey(port: number) {
  return `modem_lock:${port}`;
}

export interface ModemSession {
  proxyPort: number;
  modemId: string;
  /** C-Rank idle 슬롯 임대 (세션 종료 시 반납) */
  leased: boolean;
  lockKind: 'posting' | 'crank';
}

export async function acquireModem(
  accountId: string,
  opts?: { lockTtlSec?: number; preferredProxyPort?: number },
): Promise<ModemSession | undefined> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('modem_id, proxy_port, account_type')
    .eq('id', accountId)
    .single();

  if (!account) return undefined;

  let proxyPort: number;
  let lockKind: 'posting' | 'crank';

  try {
    proxyPort = await getModemProxyPort(accountId, opts);
    lockKind =
      account.account_type === 'posting' && account.proxy_port === proxyPort ? 'posting' : 'crank';
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('유휴 C-Rank')) {
      throw new Error('NO_IDLE_MODEM');
    }
    // 동일 물리 동글에 여러 포스팅 계정 — 락 점유 중은 대기·재시도 대상
    if (msg.includes('C-Rank 사용 중') || msg.includes('다른 계정 사용 중')) {
      throw new Error('MODEM_BUSY');
    }
    throw err;
  }

  const portKey = String(proxyPort);
  if (busyModems.has(portKey)) {
    await releaseModemLocks(proxyPort, lockKind);
    throw new Error('MODEM_BUSY');
  }
  busyModems.add(portKey);

  const { data: modem } = await supabase
    .from('huma_modems')
    .select('id')
    .eq('proxy_port', proxyPort)
    .maybeSingle();

  const modemId = modem?.id ?? account.modem_id ?? '';
  if (modemId) {
    await supabase.from('huma_modems').update({ status: 'busy' }).eq('id', modemId);
  }

  return { proxyPort, modemId, leased: lockKind === 'crank', lockKind };
}

/** 프로세스 내 동시 점유 해제 (Redis 락과 별도 — crash·재예약 시) */
export function clearInProcessModemBusy(proxyPort: number): void {
  busyModems.delete(String(proxyPort));
}

export async function releaseModem(session: ModemSession | number): Promise<void> {
  const normalized: ModemSession =
    typeof session === 'number'
      ? { proxyPort: session, modemId: '', leased: false, lockKind: 'crank' }
      : session;

  busyModems.delete(String(normalized.proxyPort));
  await releaseModemLocks(normalized.proxyPort, normalized.lockKind);

  if (normalized.modemId) {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('id', normalized.modemId)
      .neq('status', 'reconnecting');
  } else {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('proxy_port', normalized.proxyPort)
      .neq('status', 'reconnecting');
  }
}

/** 보호조치 등 — Redis·프로세스 동글 락 강제 해제 */
export async function forceReleaseModemForAccount(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('proxy_port, modem_id')
    .eq('id', accountId)
    .maybeSingle();

  const port = account?.proxy_port as number | null | undefined;
  if (!port) return;

  busyModems.delete(String(port));
  await releaseModemLocks(port, 'posting');
  await releaseModemLocks(port, 'crank');

  const modemId = (account?.modem_id as string | null) ?? (await getModemIdByProxyPort(port));
  if (modemId) {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('id', modemId)
      .neq('status', 'reconnecting');
  } else {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('proxy_port', port)
      .neq('status', 'reconnecting');
  }
}

export async function getModemIdByProxyPort(proxyPort: number): Promise<string | null> {
  const { data } = await supabase
    .from('huma_modems')
    .select('id')
    .eq('proxy_port', proxyPort)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * 전체 정지 등 — Redis posting/crank 락·프로세스 busy·DB busy 일괄 해제.
 * 네트워크 복구(flock)와 달리 lease 고착을 강제로 푼다.
 */
export async function forceReleaseAllDongleLocks(): Promise<{
  ports: number[];
  redisKeysDeleted: number;
  busyCleared: number;
  dbError?: string;
}> {
  busyModems.clear();

  const { data: modemRows } = await supabase.from('huma_modems').select('proxy_port');
  const ports = new Set<number>([...POSTING_PROXY_PORTS, ...CRANK_PROXY_PORTS]);
  for (const row of modemRows ?? []) {
    const port = Number(row.proxy_port);
    if (Number.isFinite(port) && port > 0) ports.add(port);
  }

  const portList = [...ports].sort((a, b) => a - b);
  const keySet = new Set<string>();
  for (const port of portList) {
    keySet.add(postingLockKey(port));
    keySet.add(crankLockKey(port));
  }

  // 포트 목록 밖 orphan 키까지 스캔
  try {
    const orphanKeys = await redisConnection.keys('modem_lock*');
    for (const key of orphanKeys) keySet.add(key);
  } catch {
    /* best-effort */
  }

  const keys = [...keySet];
  let redisKeysDeleted = 0;
  if (keys.length > 0) {
    redisKeysDeleted = await redisConnection.del(...keys);
  }

  const { data: clearedRows, error: updateErr } = await supabase
    .from('huma_modems')
    .update({ status: 'idle' })
    .eq('status', 'busy')
    .select('id');

  const busyCleared = clearedRows?.length ?? 0;
  const dbError = updateErr?.message;

  await logOperation({
    level: dbError ? 'ERROR' : 'warn',
    message: `[modem] 전체 동글 락 해제 — Redis ${redisKeysDeleted}키 · busy→idle ${busyCleared}슬롯 · ports=${portList.join(',')}${dbError ? ` · DB오류 ${dbError}` : ''}`,
    metadata: {
      redis_keys_deleted: redisKeysDeleted,
      busy_cleared: busyCleared,
      ports: portList,
      db_error: dbError ?? null,
    },
  });

  return { ports: portList, redisKeysDeleted, busyCleared, dbError };
}
