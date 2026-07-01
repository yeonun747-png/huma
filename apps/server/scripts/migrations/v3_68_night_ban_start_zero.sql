-- 야간 발행 금지 KST 00~07 (자정 리셋과 정렬)
UPDATE huma_settings
SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{night_ban_start}', '0'::jsonb),
    updated_at = now()
WHERE key = 'human_engine'
  AND COALESCE((value->>'night_ban_start')::int, 1) = 1;
