-- v3.9: 모뎀 역할 (포스팅 고정 / C-Rank 풀 / 카페)
ALTER TABLE huma_modems ADD COLUMN IF NOT EXISTS modem_role VARCHAR(20) DEFAULT 'crank';

COMMENT ON COLUMN huma_modems.modem_role IS 'posting | crank | cafe — C-Rank idle 풀 필터용';

-- 1단계 7슬롯 기본 역할 (포스팅 4 + C-Rank 3)
UPDATE huma_modems SET modem_role = 'posting' WHERE slot_number BETWEEN 1 AND 4;
UPDATE huma_modems SET modem_role = 'crank' WHERE slot_number BETWEEN 5 AND 10 AND modem_role IS DISTINCT FROM 'posting';
