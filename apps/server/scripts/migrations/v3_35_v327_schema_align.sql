-- v3.27 스키마 정합 (기획서 §5)
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS crank_label VARCHAR(20);
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS last_cafe_ip VARCHAR(50);
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS last_cafe_used_at TIMESTAMPTZ;

ALTER TABLE huma_jobs ADD COLUMN IF NOT EXISTS advance_requested_at TIMESTAMPTZ;
ALTER TABLE huma_jobs ADD COLUMN IF NOT EXISTS stop_reason TEXT;

ALTER TABLE huma_logs ADD COLUMN IF NOT EXISTS stop_reason TEXT;

-- CRANK-A, CRANK-B, … (50계정까지 Excel 열 방식)
CREATE OR REPLACE FUNCTION huma_crank_letter_label(idx INT) RETURNS TEXT AS $$
DECLARE
  n INT := idx + 1;
  s TEXT := '';
  r INT;
BEGIN
  WHILE n > 0 LOOP
    r := (n - 1) % 26;
    s := CHR(65 + r) || s;
    n := (n - 1) / 26;
  END LOOP;
  RETURN 'CRANK-' || s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY
      NULLIF(regexp_replace(COALESCE(slot_label, ''), '\D', '', 'g'), '')::INT NULLS LAST,
      name
  ) - 1 AS idx
  FROM huma_accounts
  WHERE account_type = 'crank'
)
UPDATE huma_accounts a
SET crank_label = huma_crank_letter_label(o.idx::INT)
FROM ordered o
WHERE a.id = o.id AND (a.crank_label IS NULL OR a.crank_label = '');

UPDATE huma_settings
SET value = jsonb_set(
  jsonb_set(COALESCE(value, '{}'::jsonb), '{initial_account_count}', '50'::jsonb),
  '{planned_crank_modems}', '2'::jsonb
)
WHERE key = 'social_crank';
