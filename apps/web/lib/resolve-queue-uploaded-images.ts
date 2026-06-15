import type { UploadedImageSlot } from '@/components/queue/queue-auto-content-modal';
import { api } from '@/lib/api';

function isHttpUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}

/** data URL → Storage URL. 이미 https면 그대로. 슬롯 순서 유지(빈 슬롯 제외). */
export async function resolveQueueUploadedImages(
  workspace: string,
  slots: UploadedImageSlot[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[] | undefined> {
  const pending = slots
    .map((raw, i) => ({ raw: raw?.trim(), i }))
    .filter((s): s is { raw: string; i: number } => Boolean(s.raw));

  const uploadTotal = pending.filter((s) => s.raw.startsWith('data:')).length;
  let uploaded = 0;
  if (uploadTotal > 0) onProgress?.(0, uploadTotal);

  const out: string[] = [];

  for (const { raw, i } of pending) {
    if (isHttpUrl(raw)) {
      out.push(raw);
      continue;
    }

    if (raw.startsWith('data:')) {
      const { url } = await api.uploadJobSlotImage({
        workspace,
        slot_index: i + 1,
        image_data: raw,
      });
      out.push(url);
      uploaded += 1;
      onProgress?.(uploaded, uploadTotal);
    }
  }

  return out.length ? out : undefined;
}
