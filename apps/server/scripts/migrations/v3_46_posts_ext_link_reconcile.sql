-- v3.46 — posts.ext_link_count 보정 (huma_jobs.link_url + 연운·퀴즈·파나나 발행 기본 1)

-- huma_jobs.link_url 있는 completed post_blog
UPDATE posts p
SET ext_link_count = 1
FROM huma_jobs j
WHERE p.account_id = j.account_id
  AND p.post_url = j.result_url
  AND j.job_type = 'post_blog'
  AND j.status = 'completed'
  AND p.ext_link_count = 0
  AND COALESCE(p.ext_link_cleared, false) = false
  AND j.link_url IS NOT NULL
  AND trim(j.link_url) <> '';

-- posting 계정(연운·퀴즈·파나나) — HUMA 발행글은 외부 OG 링크 1개 기본
UPDATE posts p
SET ext_link_count = 1
FROM huma_accounts a
WHERE p.account_id = a.id
  AND a.account_type = 'posting'
  AND a.workspace IN ('yeonun', 'quizoasis', 'panana')
  AND p.ext_link_count = 0
  AND COALESCE(p.ext_link_cleared, false) = false;

UPDATE blog_post_status b
SET ext_link_count = 1
FROM huma_accounts a
WHERE b.account_id = a.id
  AND a.account_type = 'posting'
  AND a.workspace IN ('yeonun', 'quizoasis', 'panana')
  AND b.ext_link_count = 0
  AND b.status = 'miss';
