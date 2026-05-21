-- v3.10: 모뎀 역할 — 포스팅 4 + C-Rank·카페 6 (동일 6슬롯 순환)
ALTER TABLE huma_modems ADD COLUMN IF NOT EXISTS modem_role VARCHAR(20) DEFAULT 'crank';

COMMENT ON COLUMN huma_modems.modem_role IS 'posting | crank — C-Rank·카페 idle 풀 (v3.10: 카페 전용 슬롯 없음)';

UPDATE huma_modems SET modem_role = 'posting' WHERE slot_number BETWEEN 1 AND 4;
UPDATE huma_modems SET modem_role = 'crank' WHERE slot_number BETWEEN 5 AND 10;