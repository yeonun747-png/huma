export type Workspace = 'yeonun' | 'quizoasis' | 'panana';

export type AccountType = 'posting' | 'crank' | 'cafe';

/** C-Rank·카페 공용 풀 — workspace와 무관하게 전체 admin 노출 */
export const CRANK_POOL_ACCOUNT_TYPES: AccountType[] = ['crank', 'cafe'];

export function isCrankPoolAccount(ac: { account_type: AccountType }): boolean {
  return CRANK_POOL_ACCOUNT_TYPES.includes(ac.account_type);
}

/** 공용 crank 풀 DB workspace (등록 시 canonical) */
export const CRANK_POOL_WORKSPACE: Workspace = 'yeonun';

export interface HumaAccount {
  id: string;
  name: string;
  naver_id: string;
  blog_url?: string;
  workspace: Workspace;
  shared_workspace?: Workspace;
  slot_label?: string;
  crank_label?: string;
  /** v3.28 — C-Rank 소속 서비스 (키워드·포스팅 블로그 배정) */
  crank_workspace?: Workspace;
  account_type: AccountType;
  grade: string;
  health_score: number;
  blog_index: number;
  modem_id?: string;
  proxy_port?: number;
  wpm: number;
  fingerprint?: Record<string, unknown>;
  persona?: Record<string, unknown>;
  profile_path?: string;
  warmup_day?: number;
  last_visited_our_blog?: Record<string, string>;
  is_active: boolean;
  last_posted_at?: string;
  post_count_today: number;
  crank_count_today: number;
  last_crank_at?: string;
  created_at: string;
  updated_at: string;
}
