import { logOperation } from './log-emitter.js';
import { supabase } from '../middleware/auth.js';
import { getKstYmd } from './crank-schedule-config.js';

export type CrankActivityType = '방문' | '공감' | '댓글' | '이웃';

export type CrankFeedPeriod = 'today' | 'yesterday' | '7d' | '30d';

export function parseCrankFeedPeriod(raw?: string): CrankFeedPeriod {
  if (raw === 'yesterday' || raw === '7d' || raw === '30d') return raw;
  return 'today';
}

function kstDayStartUtc(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0)).toISOString();
}

/** KST 기준 활동 피드 조회 구간 */
export function getCrankFeedRange(period: CrankFeedPeriod): { start: string; end?: string } {
  const { year, month, day } = getKstYmd();
  const todayStart = kstDayStartUtc(year, month, day);

  if (period === 'today') {
    return { start: todayStart };
  }
  if (period === 'yesterday') {
    return { start: kstDayStartUtc(year, month, day - 1), end: todayStart };
  }
  if (period === '7d') {
    const start = new Date(todayStart);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: start.toISOString() };
  }
  const start = new Date(todayStart);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: start.toISOString() };
}

export function crankFeedPeriodDays(period: CrankFeedPeriod): number {
  if (period === '7d') return 7;
  if (period === '30d') return 30;
  return 1;
}

export function crankFeedLogLimit(period: CrankFeedPeriod): number {
  if (period === '30d') return 500;
  if (period === '7d') return 200;
  return 80;
}

/** 활동 피드 — 15초 → 「0분 15초 체류」 */
export function formatCrankDwellLabel(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const min = Math.floor(total / 60);
  const s = total % 60;
  return `${min}분 ${s}초 체류`;
}

export async function logCrankActivity(params: {
  accountId: string;
  type: CrankActivityType;
  targetUrl?: string;
  targetTitle?: string;
  comment?: string;
  dwellSec?: number;
}) {
  const { data: acct } = await supabase
    .from('huma_accounts')
    .select('crank_workspace')
    .eq('id', params.accountId)
    .maybeSingle();

  const host = params.targetUrl?.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  const label = params.targetTitle ?? host ?? 'naver blog';
  const title =
    params.type === '방문'
      ? `블로그 방문 — ${label}`
      : params.type === '공감'
        ? `공감 — ${label}`
        : params.type === '댓글'
          ? `댓글 — ${label}`
          : `이웃 신청 — ${label}`;

  const sub =
    params.type === '방문' && params.dwellSec != null
      ? formatCrankDwellLabel(params.dwellSec)
      : params.targetUrl?.replace(/^https?:\/\//, '').slice(0, 48) ?? '';

  await logOperation({
    level: 'info',
    message: title,
    account_id: params.accountId,
    workspace: (acct?.crank_workspace as string | undefined) ?? 'yeonun',
    platform: 'naver_crank',
    result_url: params.targetUrl,
    metadata: {
      source: 'crank_activity',
      crank_action: params.type,
      comment: params.comment,
      target_title: params.targetTitle,
      dwell_sec: params.type === '방문' ? params.dwellSec : undefined,
      sub,
    },
  });
}
