-- HUMA Studio Full Schema (기획서 v3.2 섹션 5)

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
  naver_id VARCHAR(100) NOT NULL UNIQUE,
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
  last_visited_our_blog JSONB,
  is_active BOOLEAN DEFAULT true,
  last_posted_at TIMESTAMPTZ,
  post_count_today INTEGER DEFAULT 0,
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
  image_model VARCHAR(50) DEFAULT 'nano-banana-pro',
  image_prompt TEXT,
  generated_image_url TEXT,
  video_model VARCHAR(50) DEFAULT 'kling-3.0',
  video_prompt TEXT,
  duration_sec INTEGER DEFAULT 5,
  source_video_url TEXT,
  tts_model VARCHAR(50) DEFAULT 'eleven-v3',
  tts_script TEXT,
  tts_audio_url TEXT,
  bgm_url TEXT,
  output_video_path TEXT,
  upload_platforms TEXT[],
  caption TEXT,
  hashtags TEXT[],
  status VARCHAR(30) DEFAULT 'pending',
  current_step VARCHAR(30),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS huma_bgm_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  file_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  mood TEXT[] NOT NULL,
  genre TEXT[] NOT NULL,
  tempo VARCHAR(10),
  energy VARCHAR(10),
  bpm INTEGER,
  keywords TEXT[],
  workspace_fit TEXT[],
  platform_fit TEXT[],
  source VARCHAR(100),
  license VARCHAR(20),
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
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
('human_engine', '{"wpm_mean":55,"wpm_sigma":18,"typo_rate":0.04,"backspace_delay_ms":[200,800],"paragraph_pause_ms":[2000,8000],"review_duration_ms":[120000,300000],"night_ban_start":1,"night_ban_end":7,"active_hours":[0.1,0.05,0.05,0.05,0.08,0.15,0.35,0.55,0.7,0.85,0.9,0.88,0.75,0.8,0.85,0.9,0.95,0.92,0.88,0.82,0.7,0.5,0.3,0.15],"weekend_ratio":0.5,"min_publish_interval_hours":4,"crank_publish_ratio":1,"crank_comm_ratio":3,"fingerprint":{"canvas_spoof":true,"webgl_spoof":true,"audio_noise":true,"mouse_bezier":true,"click_jitter_px":3,"auto_pause_on_detect":true,"captcha_slack":true,"cooldown_429_hours":2}}'),
('image_engine', '{"noise_pct":0.8,"jpeg_quality_range":[90,96],"exif_randomize":true,"gps_randomize":true,"block_duplicate":true}'),
('watcher', '{"slack_webhook":"","cooldown_429_min":15,"recovery_steps_min":[12,30,120],"auto_pause":true}'),
('higgsfield', '{"default_image_model":"nano-banana-pro","default_video_model":"kling-3.0","default_tts_model":"eleven-v3","video_duration_sec":5,"aspect_ratio":"9:16"}'),
('bgm', '{"fallback_to_suno":true,"max_use_count_before_rotate":10}'),
('social_crank', '{"daily_limit_per_account":30,"min_visit_interval_days":3,"our_blog_ratio":0.25,"other_blog_ratio":0.75,"visits_per_session":15,"stay_duration_ms":[180000,300000],"keywords":["사주풀이","꿈해몽","신년운세","궁합","자미두수","운세","사주"]}')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_huma_jobs_status ON huma_jobs(status);
CREATE INDEX IF NOT EXISTS idx_huma_jobs_scheduled ON huma_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_huma_jobs_workspace ON huma_jobs(workspace);
CREATE INDEX IF NOT EXISTS idx_huma_logs_created ON huma_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huma_logs_workspace ON huma_logs(workspace, platform);
CREATE INDEX IF NOT EXISTS idx_huma_platform_accounts_ws ON huma_platform_accounts(workspace, platform);
CREATE INDEX IF NOT EXISTS idx_huma_video_queue_status ON huma_video_queue(status);
CREATE INDEX IF NOT EXISTS idx_huma_bgm_mood ON huma_bgm_library USING GIN(mood);
CREATE INDEX IF NOT EXISTS idx_huma_bgm_workspace ON huma_bgm_library USING GIN(workspace_fit);
CREATE INDEX IF NOT EXISTS idx_huma_bgm_keywords ON huma_bgm_library USING GIN(keywords);

DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'huma_accounts','huma_modems','huma_platform_accounts',
  'huma_jobs','huma_video_queue','huma_bgm_library',
  'huma_cafe_targets','huma_logs','huma_settings','huma_admins'])
LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "service only" ON %I', t);
  EXECUTE format('CREATE POLICY "service only" ON %I FOR ALL TO service_role USING (true)', t);
END LOOP; END $$;

-- ⑫ 초기 관리자 계정 (비밀번호는 bcrypt 해시 저장)
-- 연운:        yeonun        / y747sv586lon!!
-- QP 공유:     quiz_panana   / sv586lon!!
-- 슈퍼어드민:  superadmin    / sv786lon!!

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
