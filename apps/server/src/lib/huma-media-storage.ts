import { createClient } from '@supabase/supabase-js';

const BUCKET = 'huma-media';

/** 포스팅 완료 후 삭제 대상 — jobs(슬롯 업로드)·images(Imagen) */
const POST_MEDIA_PREFIXES = ['jobs/', 'images/'];

export function isDeletablePostMediaPath(storagePath: string): boolean {
  return POST_MEDIA_PREFIXES.some((prefix) => storagePath.startsWith(prefix));
}

export function collectDeletableMediaPaths(urls: string[] | null | undefined): string[] {
  if (!urls?.length) return [];
  const paths = new Set<string>();
  for (const url of urls) {
    const path = parseHumaMediaStoragePath(url);
    if (path && isDeletablePostMediaPath(path)) paths.add(path);
  }
  return [...paths];
}

export async function deleteHumaMediaPaths(
  storagePaths: string[],
): Promise<{ deleted: number; failed: string[] }> {
  const paths = [...new Set(storagePaths.filter(Boolean))];
  if (!paths.length) return { deleted: 0, failed: [] };

  const supa = supabaseAdmin();
  const { data, error } = await supa.storage.from(BUCKET).remove(paths);
  if (error) return { deleted: 0, failed: paths };

  const removed = new Set((data ?? []).map((o) => o.name));
  const failed = paths.filter((p) => !removed.has(p));
  return { deleted: removed.size, failed };
}

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) throw new Error('SUPABASE_URL/SERVICE_KEY 없음');
  return createClient(url, key);
}

/** public/sign URL → storage object path (예: images/123.jpg) */
export function parseHumaMediaStoragePath(mediaUrl: string): string | null {
  try {
    const u = new URL(mediaUrl);
    const m = u.pathname.match(/\/huma-media\/(.+)$/);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export async function downloadHumaMedia(storagePath: string): Promise<Buffer> {
  const supa = supabaseAdmin();
  const { data, error } = await supa.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new Error(error?.message ?? 'Storage download 실패');
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadHumaMediaBuffer(
  storagePath: string,
  buf: Buffer,
  contentType: string,
  opts?: { signedUrlExpiresSec?: number },
): Promise<string> {
  const supa = supabaseAdmin();
  const { error: uploadError } = await supa.storage.from(BUCKET).upload(storagePath, buf, {
    contentType,
    upsert: true,
  });
  if (uploadError) throw new Error(`Storage upload 실패: ${uploadError.message}`);

  const expires = opts?.signedUrlExpiresSec ?? 60 * 60 * 24 * 30;
  const { data: signed, error: signError } = await supa.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expires);
  if (!signError && signed?.signedUrl) return signed.signedUrl;

  const { data } = supa.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function uploadHumaMediaJpeg(
  storagePath: string,
  buf: Buffer,
  opts?: { signedUrlExpiresSec?: number },
): Promise<string> {
  return uploadHumaMediaBuffer(storagePath, buf, 'image/jpeg', opts);
}
