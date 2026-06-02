-- C-Rank 예비 슬롯 8~10: 스케줄·활성 카운트에서 제외 (물리 연결 전)
-- 현재 가동: 동글 6~7만 crank · 30일 후 8~10 연결 시 reserved → crank + status idle 로 전환

UPDATE huma_modems SET
  modem_role = 'reserved',
  status = 'offline'
WHERE slot_number IN (8, 9, 10);

COMMENT ON COLUMN huma_modems.modem_role IS 'posting | crank | reserved — reserved=예비 C-Rank(미연결)';
