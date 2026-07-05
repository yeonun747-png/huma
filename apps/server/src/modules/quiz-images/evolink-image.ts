import axios from 'axios';
import { getEvoLinkTask, hasEvoLinkApiKey } from '../video-content/evolink.js';

const API_BASE = process.env.EVOLINK_API_BASE?.trim() || 'https://api.evolink.ai';
const IMAGE_MODEL = 'gpt-image-2';

export const QUIZ_IMAGE_DEFAULTS = {
  model: IMAGE_MODEL,
  size: '1:1' as const,
  resolution: '1K' as const,
  quality: 'low' as const,
  n: 1,
};

function apiKey(): string {
  const key = process.env.EVOLINK_API_KEY?.trim();
  if (!key) throw new Error('EVOLINK_API_KEY 없음');
  return key;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
  };
}

function formatEvoLinkAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    const nestedErr = data?.error;
    if (nestedErr && typeof nestedErr === 'object' && 'message' in nestedErr) {
      const msg = (nestedErr as { message?: string }).message;
      if (msg) return `EvoLink API: ${msg}`;
    }
    for (const key of ['message', 'detail', 'error'] as const) {
      const val = data?.[key];
      if (typeof val === 'string' && val.trim()) return `EvoLink API: ${val}`;
    }
    const status = err.response?.status;
    return status ? `EvoLink API HTTP ${status}: ${err.message}` : `EvoLink API: ${err.message}`;
  }
  return (err as Error).message ?? String(err);
}

function extractTaskId(data: Record<string, unknown>): string {
  const direct = data.id ?? data.task_id;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const nested = data.data;
  if (nested && typeof nested === 'object') {
    const n = nested as Record<string, unknown>;
    const inner = n.id ?? n.task_id;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  }
  throw new Error('EvoLink task_id 없음');
}

function pickUrl(value: unknown): string | null {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['url', 'image_url', 'uri', 'download_url']) {
      const u = o[key];
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) return u;
    }
  }
  return null;
}

function extractImageUrlFromTask(task: {
  status?: string;
  results?: unknown[];
  output?: unknown;
  error?: { message?: string } | string;
}): string | null {
  if (Array.isArray(task.results)) {
    for (const item of task.results) {
      const url = pickUrl(item);
      if (url) return url;
    }
  }
  const fromOutput = pickUrl(task.output);
  if (fromOutput) return fromOutput;
  if (Array.isArray(task.output)) {
    for (const item of task.output) {
      const url = pickUrl(item);
      if (url) return url;
    }
  }
  return null;
}

function isTaskCompleted(status: string | undefined): boolean {
  return status === 'completed' || status === 'succeeded' || status === 'success';
}

function isTaskFailed(status: string | undefined): boolean {
  return status === 'failed' || status === 'error' || status === 'cancelled';
}

function taskErrorMessage(task: { error?: { message?: string } | string }): string {
  if (typeof task.error === 'string') return task.error;
  return task.error?.message ?? 'EvoLink 이미지 생성 실패';
}

export { hasEvoLinkApiKey };

export async function createEvoLinkImageTask(prompt: string): Promise<string> {
  const body = {
    model: QUIZ_IMAGE_DEFAULTS.model,
    prompt,
    size: QUIZ_IMAGE_DEFAULTS.size,
    resolution: QUIZ_IMAGE_DEFAULTS.resolution,
    quality: QUIZ_IMAGE_DEFAULTS.quality,
    n: QUIZ_IMAGE_DEFAULTS.n,
  };

  try {
    const { data } = await axios.post<Record<string, unknown>>(
      `${API_BASE}/v1/images/generations`,
      body,
      { headers: authHeaders(), timeout: 60_000 },
    );
    return extractTaskId(data ?? {});
  } catch (err) {
    throw new Error(formatEvoLinkAxiosError(err));
  }
}

export async function pollEvoLinkImageUrl(
  taskId: string,
  opts?: { maxWaitMs?: number; intervalMs?: number },
): Promise<string> {
  const maxWaitMs = opts?.maxWaitMs ?? 180_000;
  const intervalMs = opts?.intervalMs ?? 4000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const task = await getEvoLinkTask(taskId);
    const status = task.status;
    if (isTaskCompleted(status)) {
      const url = extractImageUrlFromTask(task);
      if (!url) throw new Error('EvoLink 완료 응답에 이미지 URL 없음');
      return url;
    }
    if (isTaskFailed(status)) {
      throw new Error(taskErrorMessage(task));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('EvoLink 이미지 생성 시간 초과 (3분)');
}

export async function generateQuizImage(prompt: string): Promise<{ taskId: string; imageUrl: string }> {
  const taskId = await createEvoLinkImageTask(prompt);
  const imageUrl = await pollEvoLinkImageUrl(taskId);
  return { taskId, imageUrl };
}

export async function fetchImageBytes(url: string): Promise<Buffer> {
  const { data } = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
  });
  return Buffer.from(data);
}

/** 저장(무압축) ZIP — 외부 의존성 없이 일괄 다운로드용 */
export function createStoredZip(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32(data), 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);

    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
