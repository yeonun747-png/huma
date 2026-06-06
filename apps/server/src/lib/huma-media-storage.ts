import { createClient } from '@supabase/supabase-js';

const BUCKET = 'huma-media';

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

export async function uploadHumaMediaJpeg(
  storagePath: string,
  buf: Buffer,
  opts?: { signedUrlExpiresSec?: number },
): Promise<string> {
  const supa = supabaseAdmin();
  const { error: uploadError } = await supa.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: 'image/jpeg',
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
