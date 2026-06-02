export type ModemStatus = 'idle' | 'busy' | 'reconnecting' | 'error' | 'offline';

export type ModemRole = 'posting' | 'crank' | 'reserved';

export interface HumaModem {
  id: string;
  slot_number: number;
  interface_name?: string;
  proxy_port: number;
  gateway_ip?: string;
  current_ip?: string;
  carrier?: string;
  sim_number?: string;
  status: ModemStatus;
  modem_role?: ModemRole;
  response_ms?: number;
  last_reconnect_at?: string;
  monthly_data_mb?: number;
  crank_sessions_today?: number;
  created_at: string;
}

/** 스케줄러에서 crank 동글 가용으로 보는 상태 (idle/busy/reconnecting) */
export type CrankModemScheduleStatus = 'idle' | 'busy' | 'reconnecting';