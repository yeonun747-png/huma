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
