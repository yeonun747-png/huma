-- v3.26: 이미지 → Google Imagen 4, 영상 → Higgsfield Cloud API (Kling 3.0)
-- TTS 기본 미사용 (Kling 내장 오디오)

UPDATE huma_settings
SET value = '{
  "default_image_model": "imagen-4.0-fast-generate-001",
  "default_video_model": "kling-3.0",
  "default_video_resolution": "720p",
  "video_duration_sec": 15,
  "aspect_ratio": "9:16",
  "higgsfield_plan": "Cloud",
  "monthly_credits": 1000,
  "video_credits_per_15s": 24
}'::jsonb,
    updated_at = now()
WHERE key = 'higgsfield';

UPDATE huma_settings
SET value = jsonb_set(
  value,
  '{main_tasks}',
  '["blog_post","social_caption","video_prompt"]'::jsonb
),
    updated_at = now()
WHERE key = 'ai_engine'
  AND value->'main_tasks' ? 'tts_script';

ALTER TABLE huma_video_queue
  ALTER COLUMN image_model SET DEFAULT 'imagen-4.0-fast-generate-001';

ALTER TABLE huma_video_queue
  ALTER COLUMN tts_model DROP DEFAULT;

COMMENT ON COLUMN huma_video_queue.tts_model IS 'v3.26: 기본 NULL — Kling 3.0 내장 오디오. 나레이션 필요 시만 eleven-v3 등';
