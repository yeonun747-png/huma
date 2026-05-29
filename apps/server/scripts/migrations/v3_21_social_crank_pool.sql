-- v3.21: C-Rank·카페 통합 계정 풀 규모 (초기 10 → 최대 150)

UPDATE huma_settings
SET value = jsonb_set(
      jsonb_set(COALESCE(value, '{}'::jsonb), '{initial_account_count}', '10'::jsonb),
      '{max_account_count}', '150'::jsonb
    ),
    updated_at = now()
WHERE key = 'social_crank';
