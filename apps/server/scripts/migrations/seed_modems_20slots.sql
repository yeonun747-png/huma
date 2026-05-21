-- v3.9 2단계: LTE USB 모뎀 20슬롯
-- 노트북 A: posting 4 + crank 6 (슬롯 1-10)
-- 노트북 B: crank 9 + cafe 1 (슬롯 11-20) — worker-only

INSERT INTO huma_modems (slot_number, interface_name, proxy_port, status, modem_role) VALUES
  ( 1, 'wwan0',  10001, 'idle', 'posting'),
  ( 2, 'wwan1',  10002, 'idle', 'posting'),
  ( 3, 'wwan2',  10003, 'idle', 'posting'),
  ( 4, 'wwan3',  10004, 'idle', 'posting'),
  ( 5, 'wwan4',  10005, 'idle', 'crank'),
  ( 6, 'wwan5',  10006, 'idle', 'crank'),
  ( 7, 'wwan6',  10007, 'idle', 'crank'),
  ( 8, 'wwan7',  10008, 'idle', 'crank'),
  ( 9, 'wwan8',  10009, 'idle', 'crank'),
  (10, 'wwan9',  10010, 'idle', 'crank'),
  (11, 'wwan10', 10011, 'idle', 'crank'),
  (12, 'wwan11', 10012, 'idle', 'crank'),
  (13, 'wwan12', 10013, 'idle', 'crank'),
  (14, 'wwan13', 10014, 'idle', 'crank'),
  (15, 'wwan14', 10015, 'idle', 'crank'),
  (16, 'wwan15', 10016, 'idle', 'crank'),
  (17, 'wwan16', 10017, 'idle', 'crank'),
  (18, 'wwan17', 10018, 'idle', 'crank'),
  (19, 'wwan18', 10019, 'idle', 'crank'),
  (20, 'wwan19', 10020, 'idle', 'cafe')
ON CONFLICT (slot_number) DO UPDATE SET
  interface_name = EXCLUDED.interface_name,
  proxy_port = EXCLUDED.proxy_port,
  status = EXCLUDED.status,
  modem_role = EXCLUDED.modem_role;
