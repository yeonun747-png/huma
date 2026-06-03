import axios from 'axios';
import { sleep } from '../../lib/utils.js';

/** Keys: cloud.higgsfield.ai · REST: platform.higgsfield.ai/{model_id} (공식 Python SDK와 동일) */
const API_BASE =
  process.env.HIGGSFIELD_API_BASE?.trim()?.replace(/\/$/, '') || 'https://platform.higgsfield.ai';

const TERMINAL_FAILURE = new Set(['failed', 'nsfw', 'canceled', 'cancelled', 'error']);

/** Authorization: Key {API_KEY_ID}:{API_KEY_SECRET} — JSON body에 키 넣지 않음 */
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
    'User-Agent': 'huma-server/1.0',
  };
}

function formatAxiosError(err: unknown, phase: string): Error {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    let detail = err.message;
    if (data && typeof data === 'object' && 'detail' in data) {
      detail = String((data as { detail: unknown }).detail);
    } else if (typeof data === 'string' && data.length < 200) {
      detail = data;
    }
    return new Error(`Higgsfield ${phase} 실패 (${status ?? '?'}): ${detail}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function resolveStatusUrl(job: Record<string, unknown>): string {
  const fromResponse = job.status_url as string | undefined;
  if (fromResponse) return fromResponse;

  const requestId = job.request_id as string | undefined;
  if (requestId) return `${API_BASE}/requests/${requestId}/status`;

  throw new Error('Higgsfield 응답에 request_id/status_url 없음');
}

/**
 * POST {API_BASE}/{application} + arguments JSON
 * 폴링 후 completed 본문 반환 (images / video_url 등)
 */
export async function higgsfieldRequest(
  application: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const path = application.replace(/^\//, '');
  const submitUrl = `${API_BASE}/${path}`;

  let job: Record<string, unknown>;
  try {
    const { data } = await axios.post(submitUrl, args, {
      headers: headers(),
      timeout: 120_000,
    });
    job = data as Record<string, unknown>;
  } catch (err) {
    throw formatAxiosError(err, 'submit');
  }

  const statusUrl = resolveStatusUrl(job);

  while (true) {
    await sleep(3000);
    let statusData: Record<string, unknown>;
    try {
      const { data } = await axios.get(statusUrl, { headers: headers(), timeout: 60_000 });
      statusData = data as Record<string, unknown>;
    } catch (err) {
      throw formatAxiosError(err, 'status');
    }

    const status = String(statusData.status ?? '').toLowerCase();
    if (status === 'completed') {
      return statusData;
    }
    if (TERMINAL_FAILURE.has(status)) {
      throw new Error(`Higgsfield 오류: ${status}`);
    }
  }
}

/** Higgsfield 잔여 크레딧 (API 실패 시 설정값 또는 999) */
export async function getHiggsfieldCredits(): Promise<number> {
  if (!hasHiggsfieldCredentials()) return 999;

  try {
    const { getSetting } = await import('../../lib/settings.js');
    const hg = await getSetting<{ remaining_credits?: number }>('higgsfield', {});
    if (typeof hg.remaining_credits === 'number') return hg.remaining_credits;
  } catch {
    // ignore
  }

  return 999;
}
