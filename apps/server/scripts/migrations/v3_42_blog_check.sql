-- v3.42 — 블로그 지수·수집(누락) 스캔

CREATE TABLE IF NOT EXISTS blog_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES huma_accounts(id) ON DELETE CASCADE,
  blog_url TEXT,
  idx_score DECIMAL(4,1),
  checked_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_post_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES huma_accounts(id) ON DELETE CASCADE,
  post_url TEXT NOT NULL,
  post_no VARCHAR(30) NOT NULL,
  title TEXT,
  checked_at TIMESTAMPTZ DEFAULT now(),
  status VARCHAR(10) NOT NULL CHECK (status IN ('ok', 'miss')),
  chars INTEGER DEFAULT 0,
  img_count INTEGER DEFAULT 0,
  ext_link_count INTEGER DEFAULT 0,
  miss_reason TEXT,
  published_at TIMESTAMPTZ,
  UNIQUE(account_id, post_no)
);

CREATE INDEX IF NOT EXISTS idx_blog_post_status_account ON blog_post_status(account_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_status_checked ON blog_post_status(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_post_status_status ON blog_post_status(account_id, status);
