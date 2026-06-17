-- 수동 보정: v3_47 status CHECK — ok/miss → strong/good/weak/miss
-- 증상: blog_post_status insert 시 status 'good' violates check constraint

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
