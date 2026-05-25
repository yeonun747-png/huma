-- v3.12: BGM 라이브러리·Pixabay 연동 제거 (Kling 3.0 내장 오디오 사용)

ALTER TABLE huma_video_queue DROP COLUMN IF EXISTS bgm_url;

DROP TABLE IF EXISTS huma_bgm_library;

DELETE FROM huma_settings WHERE key = 'bgm';

-- v3.12 higgsfield 기본값 (GPT Image 2 · Kling 720p 15s)
UPDATE huma_settings
SET value = '{
  "default_image_model": "gpt-image-2",
  "default_video_model": "kling-3.0",
  "default_video_resolution": "720p",
  "default_tts_model": "eleven-v3",
  "video_duration_sec": 15,
  "aspect_ratio": "9:16",
  "higgsfield_plan": "Plus",
  "monthly_credits": 1000
}'::jsonb,
updated_at = now()
WHERE key = 'higgsfield';
