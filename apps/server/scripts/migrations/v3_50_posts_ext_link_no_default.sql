-- v3.50 — 외부링크 없는 HUMA 발행글 ext_link_count=1 오표시 제거 (v3.46 워크스페이스 기본값 폐지)

UPDATE posts p
SET ext_link_count = 0
FROM huma_jobs j
WHERE p.account_id = j.account_id
  AND p.post_url = j.result_url
  AND j.job_type = 'post_blog'
  AND j.status = 'completed'
  AND COALESCE(p.ext_link_cleared, false) = false
  AND p.ext_link_count = 1
  AND (
    j.link_url IS NULL
    OR trim(j.link_url) = ''
    OR lower(j.link_url) LIKE '%naver.com%'
    OR lower(j.link_url) LIKE '%naver.me%'
  )
  AND COALESCE(j.content, '') NOT ILIKE '%yeonun.com%'
  AND COALESCE(j.content, '') NOT ILIKE '%myquizoasis.com%'
  AND COALESCE(j.content, '') NOT ILIKE '%panana.com%'
  AND COALESCE(j.content, '') NOT ILIKE '%http://%'
  AND COALESCE(j.content, '') NOT ILIKE '%https://%';
