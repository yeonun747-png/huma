-- v3.22: 모뎀 슬롯 매핑 확정 (wwan0~9 · 10001~10010) + KT 초알뜰 carrier

UPDATE huma_modems SET carrier = 'KT' WHERE carrier IS NULL OR carrier = '';

UPDATE huma_modems SET modem_role = 'posting', interface_name = 'wwan' || (slot_number - 1)::text
WHERE slot_number BETWEEN 1 AND 4;

UPDATE huma_modems SET modem_role = 'crank', interface_name = 'wwan' || (slot_number - 1)::text
WHERE slot_number BETWEEN 5 AND 10;

-- crank 계정은 proxy_port NULL 유지 (Redis 동적 할당 §7-13-1)
-- posting 4계정 예시 (실제 ID로 교체):
-- UPDATE huma_accounts SET proxy_port = 10001 WHERE id = '...' AND account_type = 'posting';
