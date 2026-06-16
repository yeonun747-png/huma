-- v3.43 — 블로그 지수 분석 v2 (posts · 일별 스냅샷 · 지수 이력)

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES huma_accounts(id) ON DELETE CASCADE,
  post_url TEXT NOT NULL,
  post_no VARCHAR(30),
  title TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  char_count INTEGER DEFAULT 0,
  img_count INTEGER DEFAULT 0,
  ext_link_count INTEGER DEFAULT 0,
  ext_link_cleared BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, post_url)
);

CREATE INDEX IF NOT EXISTS idx_posts_account_published ON posts(account_id, published_at DESC);

CREATE TABLE IF NOT EXISTS blog_index_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES huma_accounts(id) ON DELETE CASCADE,
  scanned_at DATE NOT NULL DEFAULT CURRENT_DATE,
  idx_score DECIMAL(4,1) NOT NULL,
  visitor_count INTEGER DEFAULT 0,
  buddy_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_index_history_account_day ON blog_index_history(account_id, scanned_at DESC);

-- v3.42 → v3.43 blog_post_status (일별 insert, upsert 금지)
ALTER TABLE blog_post_status DROP CONSTRAINT IF EXISTS blog_post_status_account_id_post_no_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'blog_post_status' AND column_name = 'checked_at'
  ) THEN
    ALTER TABLE blog_post_status RENAME COLUMN checked_at TO scanned_at;
  END IF;
END $$;

ALTER TABLE blog_post_status ADD COLUMN IF NOT EXISTS chars INTEGER DEFAULT 0;

UPDATE blog_post_status SET chars = 0 WHERE chars IS NULL;

ALTER TABLE blog_post_status DROP COLUMN IF EXISTS miss_reason;
ALTER TABLE blog_post_status DROP COLUMN IF EXISTS published_at;

-- scanned_at를 DATE로 (기존 timestamptz → date)
ALTER TABLE blog_post_status
  ALTER COLUMN scanned_at TYPE DATE USING (scanned_at AT TIME ZONE 'Asia/Seoul')::date;

ALTER TABLE blog_post_status ALTER COLUMN scanned_at SET DEFAULT CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_blog_post_status_account_day ON blog_post_status(account_id, scanned_at DESC);

DROP TABLE IF EXISTS blog_accounts;

-- huma_jobs → posts 백필 (최근 30일 completed post_blog)
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
  AND COALESCE(j.completed_at, j.scheduled_at, j.created_at) >= now() - interval '30 days'
ON CONFLICT (account_id, post_url) DO NOTHING;
