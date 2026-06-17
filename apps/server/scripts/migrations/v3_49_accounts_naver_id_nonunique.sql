-- 포스팅 연운1~3 등 동일 네이버 ID·PW 공유 허용 (동글별 proxy_port 분리)
ALTER TABLE huma_accounts DROP CONSTRAINT IF EXISTS huma_accounts_naver_id_key;
