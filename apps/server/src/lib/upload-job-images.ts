import { randomUUID } from 'crypto';
import { uploadHumaMediaBuffer } from './huma-media-storage.js';

const MAX_SLOTS = 5;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function parseDataUrl(raw: string): { contentType: string; buf: Buffer } | null {
  const m = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  const contentType = m[1]!.toLowerCase();
  if (!ACCEPTED.has(contentType)) {
    throw new Error(`지원하지 않는 이미지 형식: ${contentType}`);
  }
  return { contentType, buf: Buffer.from(m[2]!, 'base64') };
}

function extForContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

function isRemoteUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}

export async function persistSingleJobImageDataUrl(
  dataUrl: string,
  slotIndex: number,
  prefix?: string,
): Promise<string> {
  if (slotIndex < 1 || slotIndex > MAX_SLOTS) {
    throw new Error(`슬롯 번호는 1~${MAX_SLOTS}만 가능합니다`);
  }
  const parsed = parseDataUrl(dataUrl.trim());
  if (!parsed) throw new Error('이미지 데이터 형식 오류');
  const ext = extForContentType(parsed.contentType);
  const id = prefix ?? randomUUID();
  const path = `jobs/${id}/slot-${slotIndex}.${ext}`;
  return uploadHumaMediaBuffer(path, parsed.buf, parsed.contentType);
}

/** 큐 등록 시 data URL → huma-media. 최대 5슬롯, 빈 슬롯 무시 */
export async function persistUploadedJobImages(
  images: string[] | undefined | null,
  jobId?: string,
): Promise<string[] | null> {
  if (!images?.length) return null;

  const prefix = jobId ?? randomUUID();
  const urls: string[] = [];

  for (let i = 0; i < Math.min(MAX_SLOTS, images.length); i += 1) {
    const raw = images[i]?.trim();
    if (!raw) continue;

    if (isRemoteUrl(raw)) {
      urls.push(raw);
      continue;
    }

    if (!raw.startsWith('data:')) continue;

    const parsed = parseDataUrl(raw);
    if (!parsed) continue;

    const ext = extForContentType(parsed.contentType);
    const path = `jobs/${prefix}/slot-${i + 1}.${ext}`;
    const url = await uploadHumaMediaBuffer(path, parsed.buf, parsed.contentType);
    urls.push(url);
  }

  return urls.length ? urls : null;
}

export function normalizeUploadedImagesInput(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .slice(0, MAX_SLOTS)
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return out.length ? out : undefined;
}
