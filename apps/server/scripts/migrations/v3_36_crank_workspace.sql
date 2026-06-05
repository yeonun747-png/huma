-- v3.28 C-Rank 서비스별 배정 (연운25 / 파나나15 / 퀴즈10) + social_crank 설정
ALTER TABLE huma_accounts ADD COLUMN IF NOT EXISTS crank_workspace VARCHAR(20);

-- 기존 crank_label·slot_label 순으로 CRANK-A~AX 재배정 + crank_workspace 설정
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY
        NULLIF(regexp_replace(COALESCE(slot_label, ''), '\D', '', 'g'), '')::INT NULLS LAST,
        name
    ) - 1 AS idx
  FROM huma_accounts
  WHERE account_type = 'crank'
)
UPDATE huma_accounts a
SET
  crank_label = huma_crank_letter_label(o.idx::INT),
  crank_workspace = CASE
    WHEN o.idx < 25 THEN 'yeonun'
    WHEN o.idx < 40 THEN 'panana'
    ELSE 'quizoasis'
  END
FROM ordered o
WHERE a.id = o.id;

UPDATE huma_settings
SET value = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(value, '{}'::jsonb),
            '{our_blog_ratio}',
            '0.25'::jsonb
          ),
          '{other_blog_ratio}',
          '0.75'::jsonb
        ),
        '{keyword_pick_count}',
        '4'::jsonb
      ),
      '{assignments}',
      '{
        "yeonun":     { "range": ["CRANK-A",  "CRANK-Y"],  "count": 25 },
        "panana":     { "range": ["CRANK-Z",  "CRANK-AN"], "count": 15 },
        "quizoasis":  { "range": ["CRANK-AO", "CRANK-AX"], "count": 10 }
      }'::jsonb
    ),
    '{keyword_pools}',
    '{
      "yeonun": [
        "사주풀이","오늘운세","신년운세","꿈해몽","궁합","재회사주",
        "이직사주","명리학","자미두수","사주명리","띠별운세","타로","관상","점집후기"
      ],
      "panana": [
        "감성일기","새벽감성","위로글","웹소설추천","AI캐릭터","감성소설",
        "혼자있고싶을때","새벽3시","연애감성","힐링글","감성브이로그"
      ],
      "quizoasis": [
        "MBTI테스트","심리테스트","성격유형","연애유형","직업적성",
        "퀴즈풀기","두뇌퀴즈","심리분석","퍼즐","공감테스트"
      ]
    }'::jsonb
  ),
  '{initial_account_count}',
  '50'::jsonb
),
    updated_at = now()
WHERE key = 'social_crank';
