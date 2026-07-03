-- 야간 발행 금지 KST 23~08 (밤 11시~오전 8시)
UPDATE huma_settings
SET value = jsonb_set(
          jsonb_set(COALESCE(value, '{}'::jsonb), '{night_ban_start}', '23'::jsonb),
          '{night_ban_end}', '8'::jsonb
        ),
    updated_at = now()
WHERE key = 'human_engine'
  AND COALESCE((value->>'night_ban_start')::int, 23) IN (0, 21);
