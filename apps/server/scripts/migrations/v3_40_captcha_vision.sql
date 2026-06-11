-- v3.40 — Claude Vision CAPTCHA 자동 해결 토글 (human_engine.fingerprint.captcha_vision_auto)
UPDATE huma_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{fingerprint,captcha_vision_auto}',
  'false'::jsonb,
  true
)
WHERE key = 'human_engine'
  AND (value->'fingerprint'->>'captcha_vision_auto') IS NULL;
