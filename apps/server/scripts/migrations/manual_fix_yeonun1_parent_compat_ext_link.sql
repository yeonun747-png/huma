-- 수동 보정: 연운1 「자녀 부모 궁합…」+ posting 계정 ext_link_count
-- UI: 외부링크 ⚠1개

-- 1) 확인
SELECT p.title, p.ext_link_count, p.post_url
FROM posts p
JOIN huma_accounts a ON a.id = p.account_id
WHERE a.slot_label = '연운1'
ORDER BY p.published_at DESC
LIMIT 10;

-- 2) 해당 글 + 연운1 전체 posting ext_link_count → 1
UPDATE posts p
SET ext_link_count = 1
FROM huma_accounts a
WHERE p.account_id = a.id
  AND a.slot_label = '연운1'
  AND COALESCE(p.ext_link_cleared, false) = false
  AND p.ext_link_count = 0;

UPDATE blog_post_status b
SET ext_link_count = 1
FROM huma_accounts a
WHERE b.account_id = a.id
  AND a.slot_label = '연운1'
  AND b.ext_link_count = 0;

-- 3) huma_jobs completed 건수 확인 (30건 미만이면 DB에 발행 이력이 5건뿐)
SELECT count(*) AS completed_post_blog
FROM huma_jobs j
JOIN huma_accounts a ON a.id = j.account_id
WHERE a.slot_label = '연운1'
  AND j.job_type = 'post_blog'
  AND j.status = 'completed'
  AND j.result_url IS NOT NULL
  AND trim(j.result_url) <> '';
