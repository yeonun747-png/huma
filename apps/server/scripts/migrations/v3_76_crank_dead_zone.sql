-- v3.76 C-Rank 01~04시 활동 금지 토글 (activity_control)
UPDATE huma_settings
SET value = jsonb_set(
  COALESCE(value, '{"crank_enabled":true,"posting_enabled":true}'::jsonb),
  '{crank_dead_zone}',
  'true'::jsonb
),
    updated_at = now()
WHERE key = 'activity_control';
