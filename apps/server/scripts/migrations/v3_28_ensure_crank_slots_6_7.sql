-- C-Rank 물리 동글 6~7 row·role 복구 (v3_25 미적용·status=error 시 UI·스케줄에서 누락 방지)

INSERT INTO huma_modems (slot_number, interface_name, proxy_port, carrier, status, modem_role, gateway_ip, current_ip)
VALUES
  (6, 'dongle6', 10006, 'KT', 'idle', 'crank', '192.168.3.6', '192.168.3.6'),
  (7, 'dongle7', 10007, 'KT', 'idle', 'crank', '192.168.3.7', '192.168.3.7')
ON CONFLICT (slot_number) DO UPDATE SET
  modem_role = 'crank',
  proxy_port = EXCLUDED.proxy_port,
  gateway_ip = EXCLUDED.gateway_ip,
  current_ip = EXCLUDED.current_ip,
  status = CASE
    WHEN huma_modems.status IN ('offline', 'error') THEN 'idle'
    ELSE huma_modems.status
  END;
