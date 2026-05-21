-- v3.8: 타입 A/B 자동판단 · 영상 모델 · 플랫폼별 최적 스케줄
ALTER TABLE huma_jobs ADD COLUMN IF NOT EXISTS content_type_auto BOOLEAN DEFAULT true;
ALTER TABLE huma_jobs ADD COLUMN IF NOT EXISTS video_model VARCHAR(50);
ALTER TABLE huma_jobs ADD COLUMN IF NOT EXISTS auto_scheduled BOOLEAN DEFAULT true;
ALTER TABLE huma_jobs ADD COLUMN IF NOT EXISTS platform_schedule JSONB;

INSERT INTO huma_settings (key, value) VALUES
('optimal_schedule', '{
  "naver_blog":  {"windows": [{"start":"08:00","end":"10:00"},{"start":"19:00","end":"21:00"}]},
  "tiktok":      {"windows": [{"start":"19:00","end":"21:00"},{"start":"10:00","end":"12:00"}]},
  "instagram":   {"windows": [{"start":"09:00","end":"11:00"},{"start":"19:00","end":"21:00"}]},
  "threads":     {"windows": [{"start":"08:00","end":"10:00"},{"start":"12:00","end":"13:00"}]},
  "x":           {"windows": [{"start":"09:00","end":"10:00"},{"start":"12:00","end":"13:00"}]},
  "spread_minutes": 30
}')
ON CONFLICT (key) DO NOTHING;
