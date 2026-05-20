export type ModemStatus = 'idle' | 'busy' | 'reconnecting' | 'error';

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
  response_ms?: number;
  last_reconnect_at?: string;
  created_at: string;
}
