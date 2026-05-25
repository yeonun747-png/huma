-- v3.17: 카페 등업 후 80:20 활동 비율 (타인 답글 8 · 자문자답 2)

ALTER TABLE huma_cafe_viral_cafes
  ADD COLUMN IF NOT EXISTS activity_ratio JSONB DEFAULT '{"daily_reply":8,"self_qa":2}'::jsonb;

UPDATE huma_cafe_viral_cafes
SET activity_ratio = '{"daily_reply":8,"self_qa":2}'::jsonb
WHERE activity_ratio IS NULL;

UPDATE huma_settings
SET value = value || '{"activity_ratio":{"daily_reply":8,"self_qa":2}}'::jsonb,
    updated_at = now()
WHERE key = 'cafe_viral'
  AND NOT (value ? 'activity_ratio');
