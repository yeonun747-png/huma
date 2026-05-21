import axios from 'axios';
import { sleep } from '../../lib/utils.js';

const API_BASE = 'https://cloud.higgsfield.ai/api/v1';

function headers() {
  return {
    Authorization: `Bearer ${process.env.HIGGSFIELD_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

export async function higgsfieldRequest(
  model: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data: job } = await axios.post(
    `${API_BASE}/submit`,
    { model, arguments: args },
    { headers: headers() }
  );

  const jobId = job.request_id as string;
  while (true) {
    await sleep(3000);
    const { data: status } = await axios.get(`${API_BASE}/status/${jobId}`, {
      headers: headers(),
    });
    if (status.status === 'COMPLETED') return status.output as Record<string, unknown>;
    if (['FAILED', 'ERROR', 'CANCELLED'].includes(status.status as string)) {
      throw new Error(`Higgsfield 오류: ${status.status}`);
    }
  }
}

/** Higgsfield 잔여 크레딧 (API 실패 시 설정값 또는 999) */
export async function getHiggsfieldCredits(): Promise<number> {
  if (!process.env.HIGGSFIELD_API_KEY) return 999;

  try {
    const { data } = await axios.get(`${API_BASE}/credits`, { headers: headers(), timeout: 5000 });
    const remaining = (data as { remaining?: number; credits?: number }).remaining ?? (data as { credits?: number }).credits;
    if (typeof remaining === 'number') return remaining;
  } catch {
    // fallback below
  }

  try {
    const { getSetting } = await import('../../lib/settings.js');
    const hg = await getSetting<{ remaining_credits?: number }>('higgsfield', {});
    if (typeof hg.remaining_credits === 'number') return hg.remaining_credits;
  } catch {
    // ignore
  }

  return 999;
}
