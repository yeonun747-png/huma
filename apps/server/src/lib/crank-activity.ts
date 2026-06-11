import { logOperation } from './log-emitter.js';
import { supabase } from '../middleware/auth.js';

export type CrankActivityType = '방문' | '공감' | '댓글' | '이웃';

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
