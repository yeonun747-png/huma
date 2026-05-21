-- v3.9 1단계: LTE USB 모뎀 7슬롯 (포스팅 4 + C-Rank 3)
-- 2단계 확장: seed_modems_20slots.sql 참고

INSERT INTO huma_modems (slot_number, interface_name, proxy_port, status, modem_role) VALUES
  (1, 'wwan0', 10001, 'idle', 'posting'),
  (2, 'wwan1', 10002, 'idle', 'posting'),
  (3, 'wwan2', 10003, 'idle', 'posting'),
  (4, 'wwan3', 10004, 'idle', 'posting'),
  (5, 'wwan4', 10005, 'idle', 'crank'),
  (6, 'wwan5', 10006, 'idle', 'crank'),
  (7, 'wwan6', 10007, 'idle', 'crank')
ON CONFLICT (slot_number) DO UPDATE SET
  interface_name = EXCLUDED.interface_name,
  proxy_port = EXCLUDED.proxy_port,
  status = EXCLUDED.status,
  modem_role = EXCLUDED.modem_role;
