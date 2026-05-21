export type Workspace = 'yeonun' | 'quizoasis' | 'panana';

export type AccountType = 'posting' | 'crank' | 'cafe';

export interface HumaAccount {
  id: string;
  name: string;
  naver_id: string;
  blog_url?: string;
  workspace: Workspace;
  shared_workspace?: Workspace;
  slot_label?: string;
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
  created_at: string;
  updated_at: string;
}
