import type { UploadedImageSlot } from '@/components/queue/queue-auto-content-modal';
import { api } from '@/lib/api';

function isHttpUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw);
}

/** data URL → Storage URL. 이미 https면 그대로. 슬롯 순서 유지(빈 슬롯 제외). */
export async function resolveQueueUploadedImages(
  workspace: string,
  slots: UploadedImageSlot[],
): Promise<string[] | undefined> {
  const out: string[] = [];

  for (let i = 0; i < slots.length; i += 1) {
    const raw = slots[i]?.trim();
    if (!raw) continue;

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
    }
  }

  return out.length ? out : undefined;
}
