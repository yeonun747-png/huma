-- v3.45 — posts 전체 백필 (30일 제한 제거, 계정별 최근 발행 이력)

INSERT INTO posts (account_id, post_url, post_no, title, published_at, char_count, img_count, ext_link_count)
SELECT
  j.account_id,
  j.result_url,
  (regexp_match(j.result_url, '(?:logNo=|/)(\d{6,})'))[1],
  j.title,
  COALESCE(j.completed_at, j.scheduled_at, j.created_at),
  GREATEST(length(regexp_replace(COALESCE(j.content, ''), '[#*_`~\[\]()]', '', 'g')), 0),
  COALESCE(array_length(j.image_urls, 1), 0),
  CASE WHEN j.link_url IS NOT NULL AND trim(j.link_url) <> '' THEN 1 ELSE 0 END
FROM huma_jobs j
WHERE j.job_type = 'post_blog'
  AND j.status = 'completed'
  AND j.result_url IS NOT NULL
  AND trim(j.result_url) <> ''
  AND j.account_id IS NOT NULL
ON CONFLICT (account_id, post_url) DO NOTHING;
