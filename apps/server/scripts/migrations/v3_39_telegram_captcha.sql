-- v3.39 — Telegram 캡cha 알림 (human_engine.fingerprint.captcha_telegram)
UPDATE huma_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{fingerprint,captcha_telegram}',
  'true'::jsonb,
  true
)
WHERE key = 'human_engine'
  AND (value->'fingerprint'->>'captcha_telegram') IS NULL;
