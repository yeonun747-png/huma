-- v3.53 영상 콘텐츠 생성·미리보기 시스템 (수동 업로드용, 자동 플랫폼 업로드 제외)
-- Supabase SQL Editor에서 수동 실행

CREATE TABLE IF NOT EXISTS huma_panana_characters_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panana_character_id VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'active',
  synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huma_pcc_status
  ON huma_panana_characters_cache(status);

CREATE TABLE IF NOT EXISTS huma_video_content_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES huma_accounts(id) ON DELETE CASCADE,
  workspace VARCHAR(20) NOT NULL,
  status VARCHAR(30) DEFAULT 'generating',
  relationship_axis VARCHAR(100),
  location_keyword VARCHAR(200),
  time_of_day VARCHAR(100),
  emotion_curve VARCHAR(100),
  hook_type VARCHAR(100),
  scenario_summary TEXT,
  conti_json JSONB,
  embedding_vector JSONB,
  similarity_score DECIMAL(5,4),
  cut_type VARCHAR(20),
  duration INTEGER,
  character_used UUID REFERENCES huma_panana_characters_cache(id) ON DELETE SET NULL,
  caption_youtube TEXT,
  caption_tiktok TEXT,
  caption_instagram TEXT,
  caption_threads TEXT,
  caption_x TEXT,
  first_comment_threads TEXT,
  first_comment_x TEXT,
  uploaded_youtube BOOLEAN DEFAULT false,
  uploaded_youtube_at TIMESTAMPTZ,
  uploaded_tiktok BOOLEAN DEFAULT false,
  uploaded_tiktok_at TIMESTAMPTZ,
  uploaded_instagram BOOLEAN DEFAULT false,
  uploaded_instagram_at TIMESTAMPTZ,
  uploaded_threads BOOLEAN DEFAULT false,
  uploaded_threads_at TIMESTAMPTZ,
  uploaded_x BOOLEAN DEFAULT false,
  uploaded_x_at TIMESTAMPTZ,
  video_file_path TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huma_vch_account_created
  ON huma_video_content_history(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huma_vch_workspace_created
  ON huma_video_content_history(workspace, created_at DESC);

CREATE TABLE IF NOT EXISTS huma_subtitle_style_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES huma_accounts(id) ON DELETE CASCADE,
  font VARCHAR(50) NOT NULL,
  position VARCHAR(30) NOT NULL,
  timing VARCHAR(30) NOT NULL,
  box_style VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huma_ssh_account_created
  ON huma_subtitle_style_history(account_id, created_at DESC);
