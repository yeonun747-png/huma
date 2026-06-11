-- v3.39 — C-Rank: 허브 동글 슬롯6·7 → i7 직결 실폰 (:10006·:10007)
UPDATE huma_modems SET
  modem_role = 'crank',
  proxy_port = 10006,
  carrier = 'phone',
  status = 'offline',
  interface_name = NULL,
  current_ip = NULL,
  public_ip = NULL,
  geo_region = NULL
WHERE slot_number = 6;

UPDATE huma_modems SET
  modem_role = 'crank',
  proxy_port = 10007,
  carrier = 'phone',
  status = 'offline',
  interface_name = NULL,
  current_ip = NULL,
  public_ip = NULL,
  geo_region = NULL
WHERE slot_number = 7;
