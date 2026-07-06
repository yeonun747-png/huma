-- v3.75 C-Rank 서비스별 배정: 연운 30 (CRANK-A~AD) · 퀴즈오아시스 20 (CRANK-AE~AX) · 파나나 0
-- crank_label 순서는 유지하고 crank_workspace 만 재배정한다.

WITH labeled AS (
  SELECT
    a.id,
    (
      SELECT gs.idx
      FROM generate_series(0, 149) AS gs(idx)
      WHERE huma_crank_letter_label(gs.idx) = a.crank_label
      LIMIT 1
    ) AS idx
  FROM huma_accounts a
  WHERE a.account_type = 'crank'
)
UPDATE huma_accounts a
SET crank_workspace = CASE
  WHEN l.idx < 30 THEN 'yeonun'
  WHEN l.idx < 50 THEN 'quizoasis'
  ELSE NULL
END
FROM labeled l
WHERE a.id = l.id AND l.idx IS NOT NULL;

UPDATE huma_settings
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{assignments}',
  '{
    "yeonun":     { "range": ["CRANK-A",  "CRANK-AD"], "count": 30 },
    "panana":     { "range": ["-", "-"],                "count": 0  },
    "quizoasis":  { "range": ["CRANK-AE", "CRANK-AX"], "count": 20 }
  }'::jsonb
),
    updated_at = now()
WHERE key = 'social_crank';
