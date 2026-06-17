-- v3.47 — 블로그 지수 v4: 노출 등급(strong/good/weak/miss) · 본문 메타 컬럼

-- posts — 발행 시 본문 파싱 메타
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS quote_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS gif_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS map_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_count INTEGER DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS int_link_count INTEGER DEFAULT 0;

UPDATE posts SET
  video_count = COALESCE(video_count, 0),
  quote_count = COALESCE(quote_count, 0),
  comment_count = COALESCE(comment_count, 0),
  like_count = COALESCE(like_count, 0),
  gif_count = COALESCE(gif_count, 0),
  map_count = COALESCE(map_count, 0),
  hidden_count = COALESCE(hidden_count, 0),
  int_link_count = COALESCE(int_link_count, 0);

-- blog_post_status — 노출 등급 + 순위 + 메타
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS rank INTEGER;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS video_count INTEGER DEFAULT 0;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS quote_count INTEGER DEFAULT 0;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS gif_count INTEGER DEFAULT 0;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS map_count INTEGER DEFAULT 0;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS hidden_count INTEGER DEFAULT 0;
ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS int_link_count INTEGER DEFAULT 0;

-- 기존 CHECK(ok/miss) 제거 후 값 변환 → 새 CHECK (순서 중요)
ALTER TABLE blog_post_status DROP CONSTRAINT IF EXISTS blog_post_status_status_check;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'blog_post_status'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE blog_post_status DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

UPDATE blog_post_status SET status = 'good' WHERE status = 'ok';

ALTER TABLE blog_post_status ADD CONSTRAINT blog_post_status_status_check
  CHECK (status IN ('strong', 'good', 'weak', 'miss'));
