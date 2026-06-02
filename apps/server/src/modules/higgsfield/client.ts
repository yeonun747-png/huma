import axios from 'axios';
import { sleep } from '../../lib/utils.js';

const API_BASE = 'https://cloud.higgsfield.ai/api/v1';

/** cloud.higgsfield.ai — Authorization: Key {API_KEY_ID}:{API_KEY_SECRET} */
export function getHiggsfieldAuthorization(): string | null {
  const id = process.env.HIGGSFIELD_API_KEY_ID?.trim();
  const secret = process.env.HIGGSFIELD_API_KEY_SECRET?.trim();
  if (id && secret) return `Key ${id}:${secret}`;

  const combined = process.env.HIGGSFIELD_API_KEY?.trim();
  if (!combined) return null;
  if (combined.includes(':')) return `Key ${combined}`;
  return `Bearer ${combined}`;
}

export function hasHiggsfieldCredentials(): boolean {
  return getHiggsfieldAuthorization() !== null;
}

function headers() {
  const authorization = getHiggsfieldAuthorization();
  if (!authorization) throw new Error('Higgsfield API 자격 증명 없음 (HIGGSFIELD_API_KEY_ID + SECRET)');
  return {
    Authorization: authorization,
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
  if (!hasHiggsfieldCredentials()) return 999;

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
