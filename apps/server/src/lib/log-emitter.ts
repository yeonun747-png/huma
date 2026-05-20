import type { Server } from 'socket.io';
import { supabase } from '../middleware/auth.js';

let io: Server | null = null;

export function setLogSocket(server: Server) {
  io = server;
}

export async function logOperation(params: {
  level: string;
  message: string;
  workspace?: string;
  platform?: string;
  account_id?: string;
  job_id?: string;
  modem_id?: string;
  result_url?: string;
  metadata?: Record<string, unknown>;
}) {
  const entry = {
    level: params.level,
    message: params.message,
    workspace: params.workspace ?? null,
    platform: params.platform ?? null,
    account_id: params.account_id ?? null,
    job_id: params.job_id ?? null,
    modem_id: params.modem_id ?? null,
    result_url: params.result_url ?? null,
    metadata: params.metadata ?? null,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('huma_logs').insert(entry);
  } catch {
    // Supabase 미연결 시 콘솔만
  }

  io?.emit('log', entry);
}
