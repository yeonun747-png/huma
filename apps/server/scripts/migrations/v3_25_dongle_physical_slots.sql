-- 물리 동글 1~5 = 192.168.3.1~.5 · 연운1~3 · 파나나4 · 퀴즈5

UPDATE huma_modems SET
  modem_role = 'posting',
  proxy_port = 10001,
  gateway_ip = '192.168.3.1',
  current_ip = '192.168.3.1',
  interface_name = COALESCE(NULLIF(interface_name, ''), 'dongle1')
WHERE slot_number = 1;

UPDATE huma_modems SET
  modem_role = 'posting',
  proxy_port = 10002,
  gateway_ip = '192.168.3.2',
  current_ip = '192.168.3.2',
  interface_name = COALESCE(NULLIF(interface_name, ''), 'dongle2')
WHERE slot_number = 2;

UPDATE huma_modems SET
  modem_role = 'posting',
  proxy_port = 10003,
  gateway_ip = '192.168.3.3',
  current_ip = '192.168.3.3',
  interface_name = COALESCE(NULLIF(interface_name, ''), 'dongle3')
WHERE slot_number = 3;

UPDATE huma_modems SET
  modem_role = 'posting',
  proxy_port = 10004,
  gateway_ip = '192.168.3.4',
  current_ip = '192.168.3.4',
  interface_name = COALESCE(NULLIF(interface_name, ''), 'dongle4')
WHERE slot_number = 4;

UPDATE huma_modems SET
  modem_role = 'posting',
  proxy_port = 10005,
  gateway_ip = '192.168.3.5',
  current_ip = '192.168.3.5',
  interface_name = COALESCE(NULLIF(interface_name, ''), 'dongle5')
WHERE slot_number = 5;

UPDATE huma_modems SET
  modem_role = 'crank',
  proxy_port = 10006,
  gateway_ip = '192.168.3.6',
  current_ip = '192.168.3.6'
WHERE slot_number = 6;

UPDATE huma_modems SET
  modem_role = 'crank',
  proxy_port = 10007,
  gateway_ip = '192.168.3.7',
  current_ip = '192.168.3.7'
WHERE slot_number = 7;

-- 포스팅 계정 동글 재할당 (물리 번호 기준)
UPDATE huma_accounts SET proxy_port = 10004
WHERE account_type = 'posting' AND workspace = 'panana';

UPDATE huma_accounts SET proxy_port = 10005
WHERE account_type = 'posting' AND workspace = 'quizoasis';
