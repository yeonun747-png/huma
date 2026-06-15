/** 등록 이미지 N장일 때 본문 내 삽입 비율 (마지막 슬롯은 OG 아래) */
const IN_BODY_FRACTIONS: Record<number, number[]> = {
  2: [0.5],
  3: [0.3, 0.6],
  4: [0.2, 0.4, 0.6],
  5: [0.1, 0.2, 0.3, 0.4],
};

/** fraction 지점 직후 단락 인덱스 (0-based, 해당 단락 타이핑 후 이미지 삽입) */
export function paragraphIndexAfterFraction(paragraphCount: number, fraction: number): number {
  if (paragraphCount <= 1) return 0;
  const idx = Math.floor(paragraphCount * fraction) - 1;
  return Math.max(0, Math.min(paragraphCount - 2, idx));
}

/** 본문 단락 경계에 삽입할 이미지 URL 인덱스 (imageUrls 배열 기준) */
export function computeInBodyImageSlots(imageCount: number, paragraphCount: number): number[] {
  if (imageCount <= 1 || paragraphCount <= 0) return [];
  const fractions = IN_BODY_FRACTIONS[imageCount];
  if (!fractions?.length) return [];

  const inBodyCount = imageCount - 1;
  const seen = new Set<number>();
  const slots: number[] = [];

  for (let i = 0; i < inBodyCount; i += 1) {
    const frac = fractions[i] ?? fractions[fractions.length - 1]!;
    let paraIdx = paragraphIndexAfterFraction(paragraphCount, frac);
    while (seen.has(paraIdx) && paraIdx < paragraphCount - 1) paraIdx += 1;
    seen.add(paraIdx);
    slots.push(i);
  }

  return slots;
}

/** afterParagraphIndex → imageUrls[slotIndex] */
export function buildInBodyImageMap(content: string, imageUrls: string[]): Map<number, string> {
  const paragraphs = content.split('\n\n').filter(Boolean);
  const map = new Map<number, string>();
  if (imageUrls.length <= 1 || paragraphs.length === 0) return map;

  const slotIndices = computeInBodyImageSlots(imageUrls.length, paragraphs.length);
  const fractions = IN_BODY_FRACTIONS[imageUrls.length] ?? [];
  const seen = new Set<number>();

  for (let i = 0; i < slotIndices.length; i += 1) {
    const slot = slotIndices[i]!;
    const frac = fractions[i] ?? fractions[fractions.length - 1]!;
    let paraIdx = paragraphIndexAfterFraction(paragraphs.length, frac);
    while (seen.has(paraIdx) && paraIdx < paragraphs.length - 1) paraIdx += 1;
    seen.add(paraIdx);
    const url = imageUrls[slot];
    if (url) map.set(paraIdx, url);
  }

  return map;
}

/** OG·링크 아래에 넣을 마지막 슬롯 URL (Imagen 0장·등록 1장 이상 공통) */
export function resolveTrailingBlogImageUrl(imageUrls: string[]): string | undefined {
  if (imageUrls.length === 0) return undefined;
  return imageUrls[imageUrls.length - 1];
}

/** SNS·영상 파이프라인용 대표(1번 슬롯) */
export function resolveFeaturedBlogImageUrl(imageUrls: string[]): string | undefined {
  return imageUrls[0];
}
