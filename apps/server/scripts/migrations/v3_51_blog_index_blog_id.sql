-- v3.51 — blog_index_history.blog_id (계정·블로그 교체 시 예전 HUMA 지수 분리)

ALTER TABLE blog_index_history ADD COLUMN IF NOT EXISTS blog_id TEXT;

CREATE INDEX IF NOT EXISTS idx_blog_index_history_account_blog
  ON blog_index_history(account_id, blog_id, scanned_at DESC);
