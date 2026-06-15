const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.82;

/** 큐 등록용 — 긴 변 MAX_EDGE, JPEG/WebP 압축으로 API 본문 크기 절감 */
export async function compressImageFileForUpload(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    let { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지 처리 실패');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const mime =
      file.type === 'image/webp'
        ? 'image/webp'
        : file.type === 'image/png'
          ? 'image/png'
          : 'image/jpeg';

    if (mime === 'image/jpeg') {
      return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    }
    if (mime === 'image/webp') {
      return canvas.toDataURL('image/webp', JPEG_QUALITY);
    }
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}
