-- HUMA Studio Full Schema (기획서 v3.22 섹션 5)
-- account_type: posting(지수5) | crank(C-Rank·카페 통합, 초기 10→최대 150) | cafe(레거시)
-- 모뎀: slot 1-4 posting(10001-10004) · slot 5-10 crank 순환(10005-10010, Redis 락)

CREATE TABLE IF NOT EXISTS huma_modems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_number INTEGER NOT NULL UNIQUE,
  interface_name VARCHAR(20),
  proxy_port INTEGER NOT NULL UNIQUE,
  gateway_ip VARCHAR(20),
  current_ip VARCHAR(50),
  carrier VARCHAR(10),
  sim_number VARCHAR(20),
  status VARCHAR(20) DEFAULT 'idle',
  response_ms INTEGER,
  last_reconnect_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  naver_id VARCHAR(100) NOT NULL,
  naver_pw_enc TEXT NOT NULL,
  blog_url VARCHAR(200),
  workspace VARCHAR(20) NOT NULL,
  shared_workspace VARCHAR(20),
  slot_label VARCHAR(50),
  account_type VARCHAR(20) DEFAULT 'crank',
  grade VARCHAR(10) DEFAULT 'B',
  health_score INTEGER DEFAULT 100,
  blog_index DECIMAL(3,1) DEFAULT 0,
  modem_id UUID REFERENCES huma_modems(id),
  proxy_port INTEGER,
  wpm INTEGER DEFAULT 52,
  fingerprint JSONB,
  persona JSONB,
  profile_path TEXT,
  warmup_day INTEGER DEFAULT 0,
  last_visited_our_blog JSONB,
  is_active BOOLEAN DEFAULT true,
  last_posted_at TIMESTAMPTZ,
  post_count_today INTEGER DEFAULT 0,
  posting_reserved_today INTEGER NOT NULL DEFAULT 0,
  posting_reserved_kst_date VARCHAR(10),
  crank_count_today INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_platform_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace VARCHAR(20) NOT NULL,
  platform VARCHAR(30) NOT NULL,
  username VARCHAR(100) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  platform_user_id VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  last_posted_at TIMESTAMPTZ,
  post_count_today INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace, platform)
);

CREATE TABLE IF NOT EXISTS huma_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bull_job_id VARCHAR(100),
  account_id UUID REFERENCES huma_accounts(id),
  platform_account_id UUID REFERENCES huma_platform_accounts(id),
  workspace VARCHAR(20),
  job_type VARCHAR(50) NOT NULL,
  title TEXT,
  content TEXT,
  image_urls TEXT[],
  link_url TEXT,
  hashtags TEXT[],
  platform VARCHAR(30),
  content_type VARCHAR(5) DEFAULT 'A',
  content_type_auto BOOLEAN DEFAULT true,
  video_model VARCHAR(50),
  auto_scheduled BOOLEAN DEFAULT true,
  platform_schedule JSONB,
  scheduled_at TIMESTAMPTZ,
  repeat_rule VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  result_url TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_video_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace VARCHAR(20) NOT NULL,
  job_id UUID REFERENCES huma_jobs(id),
  image_model VARCHAR(50) DEFAULT 'gpt-image-2',
  image_prompt TEXT,
  generated_image_url TEXT,
  video_model VARCHAR(50) DEFAULT 'kling-3.0',
  video_prompt TEXT,
  duration_sec INTEGER DEFAULT 15,
  source_video_url TEXT,
  tts_model VARCHAR(50) DEFAULT 'eleven-v3',
  tts_script TEXT,
  tts_audio_url TEXT,
  output_video_path TEXT,
  upload_platforms TEXT[],
  caption TEXT,
  hashtags TEXT[],
  blog_job_id UUID REFERENCES huma_jobs(id),
  threads_job_id UUID REFERENCES huma_jobs(id),
  twitter_job_id UUID REFERENCES huma_jobs(id),
  tiktok_result_url TEXT,
  instagram_result_url TEXT,
  youtube_result_url TEXT,
  status VARCHAR(30) DEFAULT 'pending',
  current_step VARCHAR(30),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_cafe_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id VARCHAR(50) DEFAULT 'jeomsamo',
  post_url TEXT NOT NULL UNIQUE,
  post_title TEXT,
  reply_content TEXT,
  is_replied BOOLEAN DEFAULT false,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_cafe_viral_cafes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace VARCHAR(20) NOT NULL DEFAULT 'yeonun',
  cafe_url VARCHAR(100) NOT NULL UNIQUE,
  cafe_name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  member_count INTEGER,
  join_required BOOLEAN DEFAULT true,
  min_grade VARCHAR(20),
  keywords TEXT[] NOT NULL DEFAULT '{}',
  grade_requirements JSONB,
  grade_auto_detected BOOLEAN DEFAULT false,
  grade_detected_at TIMESTAMPTZ,
  activity_ratio JSONB DEFAULT '{"daily_reply":8,"self_qa":2}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS huma_cafe_warmup_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES huma_accounts(id) ON DELETE CASCADE,
  cafe_id UUID REFERENCES huma_cafe_viral_cafes(id) ON DELETE CASCADE,
  greeting_posted BOOLEAN DEFAULT false,
  comment_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  is_graded_up BOOLEAN DEFAULT false,
  graded_up_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'warming',
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, cafe_id)
);

CREATE TABLE IF NOT EXISTS huma_cafe_viral_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cafe_id UUID REFERENCES huma_cafe_viral_cafes(id) ON DELETE CASCADE,
  workspace VARCHAR(20) NOT NULL,
  post_url TEXT NOT NULL UNIQUE,
  post_title TEXT,
  post_content TEXT,
  keyword_matched TEXT[],
  reply_drafted TEXT,
  reply_posted TEXT,
  account_id UUID REFERENCES huma_accounts(id),
  is_self_post BOOLEAN DEFAULT false,
  parent_post_id UUID REFERENCES huma_cafe_viral_posts(id),
  status VARCHAR(20) DEFAULT 'pending',
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS huma_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES huma_jobs(id),
  account_id UUID REFERENCES huma_accounts(id),
  modem_id UUID REFERENCES huma_modems(id),
  workspace VARCHAR(20),
  platform VARCHAR(30),
  level VARCHAR(10) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  result_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(200) NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  name VARCHAR(100) NOT NULL,
  workspaces TEXT[] NOT NULL,
  is_super BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO huma_settings (key, value) VALUES
('human_engine', '{"wpm_mean":55,"wpm_sigma":18,"typo_rate":0.04,"backspace_delay_ms":[200,800],"paragraph_pause_ms":[2000,8000],"review_duration_ms":[120000,300000],"night_ban_start":1,"night_ban_end":7,"active_hours":[0.1,0.05,0.05,0.05,0.08,0.15,0.35,0.55,0.7,0.85,0.9,0.88,0.75,0.8,0.85,0.9,0.95,0.92,0.88,0.82,0.7,0.5,0.3,0.15],"weekend_ratio":0.5,"min_publish_interval_hours":2,"crank_publish_ratio":1,"crank_comm_ratio":3,"fingerprint":{"canvas_spoof":true,"webgl_spoof":true,"audio_noise":true,"mouse_bezier":true,"click_jitter_px":3,"auto_pause_on_detect":true,"captcha_slack":true,"cooldown_429_hours":2}}'),
('image_engine', '{"noise_pct":0.3,"jpeg_quality_range":[90,96],"exif_randomize":true,"gps_randomize":true,"block_duplicate":true}'),
('watcher', '{"slack_webhook":"","cooldown_429_min":15,"recovery_steps_min":[12,30,120],"auto_pause":true,"gradual_recovery":true}'),
('app_settings', '{"claude_api":true,"higgsfield_api":true,"slack_webhook":true,"daily_limit":true,"night_ban":true}'),
('higgsfield', '{"default_image_model":"gpt-image-2","default_video_model":"kling-3.0","default_video_resolution":"720p","default_tts_model":"eleven-v3","video_duration_sec":15,"aspect_ratio":"9:16","higgsfield_plan":"Plus","monthly_credits":1000}'),
('optimal_schedule', '{"naver_blog":{"windows":[{"start":"08:00","end":"10:00"},{"start":"19:00","end":"21:00"}]},"tiktok":{"windows":[{"start":"19:00","end":"21:00"},{"start":"10:00","end":"12:00"}]},"instagram":{"windows":[{"start":"09:00","end":"11:00"},{"start":"19:00","end":"21:00"}]},"threads":{"windows":[{"start":"08:00","end":"10:00"},{"start":"12:00","end":"13:00"}]},"x":{"windows":[{"start":"09:00","end":"10:00"},{"start":"12:00","end":"13:00"}]},"spread_minutes":30}'),
('social_crank', '{"daily_limit_per_account":30,"min_visit_interval_days":5,"our_blog_ratio":0.25,"other_blog_ratio":0.75,"visits_per_session":15,"stay_duration_ms":[180000,300000],"initial_account_count":10,"max_account_count":150,"keywords":["사주풀이","꿈해몽","신년운세","궁합","자미두수","운세","사주"]}'),
('ai_engine', '{"main_model":"claude-sonnet-4-6","sub_model":"claude-haiku-4-5-20251001","main_tasks":["blog_post","social_caption","tts_script","video_prompt"],"sub_tasks":["hashtags","summary","autoDecide"],"max_input_tokens":8000,"max_output_tokens":4000}'),
('cafe_viral', '{"enabled":true,"target_workspace":"yeonun","note":"카페 침투는 연운 전용. 퀴즈·파나나는 카페 바이럴 미적용.","keywords_yeonun":["신점추천","사주봐줘","운세추천","사주어플","신점어플","궁합봐주세요","오늘운세"],"post_style":"고민·경험담 질문형 (서비스명 직접 언급 금지)","reply_style":"경험담 공감형","self_qa_enabled":true,"self_qa_delay_min":60,"mention_rate":0.0,"daily_limit_per_cafe":3,"daily_limit_total":10,"activity_ratio":{"daily_reply":8,"self_qa":2},"min_post_age_hours":1,"max_post_age_days":7}'),
('posting_schedule', '{"weekday":{"yeonun_blog":6,"quizoasis_panana_blog":2,"total_blog":8,"type_b_ratio":0.5,"videos_per_day":4},"weekend":{"yeonun_blog":3,"quizoasis_panana_blog":2,"total_blog":5,"type_b_ratio":0.5,"videos_per_day":3},"cafe":{"daily":2,"type":"text_image_only","credit_cost":0},"monthly_estimate":{"weekday_days":22,"weekend_days":8,"total_videos":112,"total_credits":1008,"plan":"Higgsfield Plus 1000 credits"}}')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_huma_jobs_status ON huma_jobs(status);
CREATE INDEX IF NOT EXISTS idx_huma_jobs_scheduled ON huma_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_huma_jobs_workspace ON huma_jobs(workspace);
CREATE INDEX IF NOT EXISTS idx_huma_logs_created ON huma_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huma_logs_workspace ON huma_logs(workspace, platform);
CREATE INDEX IF NOT EXISTS idx_huma_platform_accounts_ws ON huma_platform_accounts(workspace, platform);
CREATE INDEX IF NOT EXISTS idx_huma_video_queue_status ON huma_video_queue(status);

CREATE INDEX IF NOT EXISTS idx_huma_cafe_viral_posts_status ON huma_cafe_viral_posts(status);
CREATE INDEX IF NOT EXISTS idx_huma_cafe_viral_posts_workspace ON huma_cafe_viral_posts(workspace);
CREATE INDEX IF NOT EXISTS idx_huma_cafe_viral_cafes_ws ON huma_cafe_viral_cafes(workspace);

DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'huma_accounts','huma_modems','huma_platform_accounts',
  'huma_jobs','huma_video_queue',
  'huma_cafe_targets','huma_cafe_viral_cafes','huma_cafe_warmup_accounts','huma_cafe_viral_posts',
  'huma_logs','huma_settings','huma_admins'])
LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "service only" ON %I', t);
  EXECUTE format('CREATE POLICY "service only" ON %I FOR ALL TO service_role USING (true)', t);
END LOOP; END $$;

-- ⑫ 초기 관리자 계정 (비밀번호는 bcrypt 해시로만 저장)
-- 초기 비밀번호는 저장소에 평문으로 두지 않는다. 배포 시 안전한 채널로 별도 전달하고,
-- 최초 로그인 후 즉시 변경한다. 해시 재생성: node -e "require('bcrypt').hash(PW,10).then(console.log)"

INSERT INTO huma_admins (email, pw_hash, name, workspaces, is_super) VALUES
(
  'yeonun',
  '$2b$10$wlAs6Krpz50trI6VTN1pHuQu.XGBFyCXZjMLtmR/x1mEcg.//0rai',
  '연운 담당자',
  ARRAY['yeonun'],
  false
),
(
  'quiz_panana',
  '$2b$10$N1f7X3c5BB5.CLbG4AI1nuQIlHzdJvbR/3gB9j.vsy8AKob95NQQq',
  '퀴즈오아시스+파나나 담당자',
  ARRAY['quizoasis', 'panana'],
  false
),
(
  'superadmin',
  '$2b$10$8Ff42EZSPpMREjlwmSZyEOtIYebb.cqqgU2uAI7KKjkd0dBd8U1Ze',
  '슈퍼 관리자',
  ARRAY['yeonun', 'quizoasis', 'panana'],
  true
)
ON CONFLICT (email) DO NOTHING;
