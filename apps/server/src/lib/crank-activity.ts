import { logOperation } from './log-emitter.js';

export type CrankActivityType = '방문' | '공감' | '댓글' | '이웃';

export async function logCrankActivity(params: {
  accountId: string;
  type: CrankActivityType;
  targetUrl?: string;
  targetTitle?: string;
  comment?: string;
  dwellSec?: number;
}) {
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
    params.type === '방문' && params.dwellSec
      ? `${Math.round(params.dwellSec / 60)}분 체류`
      : params.targetUrl?.replace(/^https?:\/\//, '').slice(0, 48) ?? '';

  await logOperation({
    level: 'info',
    message: title,
    account_id: params.accountId,
    workspace: 'yeonun',
    platform: 'naver_crank',
    result_url: params.targetUrl,
    metadata: {
      source: 'crank_activity',
      crank_action: params.type,
      comment: params.comment,
      target_title: params.targetTitle,
      sub,
    },
  });
}
