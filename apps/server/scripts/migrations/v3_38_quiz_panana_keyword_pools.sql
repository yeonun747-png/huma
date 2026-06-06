-- v3.38 퀴즈오아시스·파나나 SEO/C-Rank 키워드풀 교체
UPDATE huma_settings
SET
  value = jsonb_set(
    value,
    '{keyword_pools,quizoasis}',
    '[
      "MBTI 테스트","심리테스트","성격테스트","연애테스트","성격유형검사",
      "무료MBTI","MBTI궁합","연애유형테스트","직업적성테스트","퍼스널컬러테스트",
      "에니어그램","애착유형테스트","직장인테스트","공감능력테스트","두뇌유형테스트"
    ]'::jsonb
  ),
  updated_at = now()
WHERE key = 'social_crank';

UPDATE huma_settings
SET
  value = jsonb_set(
    value,
    '{keyword_pools,panana}',
    '[
      "AI친구","AI캐릭터","캐릭터챗봇","AI채팅","감성AI","AI대화","AI소울메이트",
      "새벽감성","위로글","감성일기","혼자있고싶을때","AI남자친구","AI여자친구","감성채팅","외로울때"
    ]'::jsonb
  ),
  updated_at = now()
WHERE key = 'social_crank';

-- 빈·구버전 풀 캐시 무효화 → 다음 조회 시 재생성
DELETE FROM huma_settings
WHERE key IN ('seo_snapshot_quizoasis', 'seo_snapshot_panana', 'seo_snapshot_yeonun');
