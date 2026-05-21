-- LTE USB 모뎀 10슬롯 (v3.10 확정)
-- 포스팅 4 (슬롯 1-4, proxy_port 고정) + C-Rank·카페 6 (슬롯 5-10, idle 순환)
-- setup-proxy.sh 실행 후 Supabase SQL Editor에서 1회 실행
INSERT INTO huma_modems (slot_number, interface_name, proxy_port, status, modem_role) VALUES
  ( 1, 'wwan0', 10001, 'idle', 'posting'),
  ( 2, 'wwan1', 10002, 'idle', 'posting'),
  ( 3, 'wwan2', 10003, 'idle', 'posting'),
  ( 4, 'wwan3', 10004, 'idle', 'posting'),
  ( 5, 'wwan4', 10005, 'idle', 'crank'),
  ( 6, 'wwan5', 10006, 'idle', 'crank'),
  ( 7, 'wwan6', 10007, 'idle', 'crank'),
  ( 8, 'wwan7', 10008, 'idle', 'crank'),
  ( 9, 'wwan8', 10009, 'idle', 'crank'),
  (10, 'wwan9', 10010, 'idle', 'crank')
ON CONFLICT (slot_number) DO UPDATE SET
  interface_name = EXCLUDED.interface_name,
  proxy_port = EXCLUDED.proxy_port,
  status = EXCLUDED.status,
  modem_role = EXCLUDED.modem_role;
-- 장치 확인 예시 (Ubuntu Worker 터미널):
--   ip -br link | grep wwan
--   ip -4 addr show wwan0
-- 연결된 슬롯 IP 반영:
--   UPDATE huma_modems SET current_ip = 'xxx.xxx.xxx.xxx', carrier = 'LG', status = 'idle'
--   WHERE slot_number = 1;
