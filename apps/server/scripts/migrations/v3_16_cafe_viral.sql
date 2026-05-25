-- v3.16: 카페 침투 바이럴 + ai_engine + posting_schedule

-- ⑦-1 카페 침투 바이럴 — 타겟 카페
CREATE TABLE IF NOT EXISTS huma_cafe_viral_cafes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace VARCHAR(20) NOT NULL,
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
  is_active BOOLEAN DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ⑦-1-1 카페 전용 계정 등업 워밍업 진행도
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

-- ⑦-2 카페 침투 바이럴 — 감지된 타겟 게시글
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

CREATE INDEX IF NOT EXISTS idx_huma_cafe_viral_posts_status ON huma_cafe_viral_posts(status);
CREATE INDEX IF NOT EXISTS idx_huma_cafe_viral_posts_workspace ON huma_cafe_viral_posts(workspace);
CREATE INDEX IF NOT EXISTS idx_huma_cafe_viral_cafes_ws ON huma_cafe_viral_cafes(workspace);

-- huma_video_queue v3.16 기본값
ALTER TABLE huma_video_queue ALTER COLUMN duration_sec SET DEFAULT 15;
ALTER TABLE huma_video_queue ALTER COLUMN image_model SET DEFAULT 'gpt-image-2';

-- v3.16 settings seed
INSERT INTO huma_settings (key, value) VALUES
('ai_engine', '{"main_model":"claude-sonnet-4-6","sub_model":"claude-haiku-4-5-20251001","main_tasks":["blog_post","social_caption","tts_script","video_prompt"],"sub_tasks":["hashtags","summary","autoDecide"],"max_input_tokens":8000,"max_output_tokens":4000}'::jsonb),
('cafe_viral', '{"enabled":true,"keywords_yeonun":["신점추천","사주봐줘","운세추천","사주어플","신점어플","궁합봐주세요","오늘운세"],"keywords_quizoasis":["심리테스트추천","MBTI테스트","성격테스트","심리검사"],"keywords_panana":["AI캐릭터","캐릭터챗","AI채팅","가상연애"],"post_style":"고민·경험담 질문형 (서비스명 직접 언급 금지)","reply_style":"경험담 공감형","self_qa_enabled":true,"self_qa_delay_min":60,"mention_rate":0.0,"daily_limit_per_cafe":3,"daily_limit_total":10,"min_post_age_hours":1,"max_post_age_days":7}'::jsonb),
('posting_schedule', '{"weekday":{"yeonun_blog":6,"quizoasis_panana_blog":2,"total_blog":8,"type_b_ratio":0.5,"videos_per_day":4},"weekend":{"yeonun_blog":3,"quizoasis_panana_blog":2,"total_blog":5,"type_b_ratio":0.5,"videos_per_day":3},"cafe":{"daily":2,"type":"text_image_only","credit_cost":0},"monthly_estimate":{"weekday_days":22,"weekend_days":8,"total_videos":112,"total_credits":1008,"plan":"Higgsfield Plus 1000 credits"}}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- RLS (viral tables)
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'huma_cafe_viral_cafes','huma_cafe_warmup_accounts','huma_cafe_viral_posts'])
LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "service only" ON %I', t);
  EXECUTE format('CREATE POLICY "service only" ON %I FOR ALL TO service_role USING (true)', t);
END LOOP; END $$;
