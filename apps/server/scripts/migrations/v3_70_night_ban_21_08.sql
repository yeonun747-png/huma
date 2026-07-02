-- 야간 발행 금지 KST 21~08 (밤 9시~오전 8시)
UPDATE huma_settings
SET value = jsonb_set(
          jsonb_set(COALESCE(value, '{}'::jsonb), '{night_ban_start}', '21'::jsonb),
          '{night_ban_end}', '8'::jsonb
        ),
    updated_at = now()
WHERE key = 'human_engine';
