import { NextRequest, NextResponse } from 'next/server';

export const HUMA_UPSTREAM_BASE =
  process.env.HUMA_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_HUMA_API_URL?.trim() ||
  'http://localhost:3100';

/** 브라우저 → romang-ai.com 동일 출처 → i7 API (광고 차단·CORS 회피) */
export async function proxyToHumaApi(
  request: NextRequest,
  upstreamPath: string,
  opts?: { method?: string; timeoutMs?: number },
): Promise<NextResponse> {
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const url = new URL(`${HUMA_UPSTREAM_BASE}${path}`);
  request.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const token = request.headers.get('x-huma-key');
  const headers: Record<string, string> = {};
  if (token) headers['X-HUMA-KEY'] = token;
  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  const method = opts?.method ?? request.method;
  const body = method !== 'GET' && method !== 'HEAD' ? await request.text() : undefined;
  const timeoutMs = opts?.timeoutMs ?? 25_000;

  try {
    const upstream = await fetch(url.toString(), {
      method,
      headers,
      body: body || undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const respBody = await upstream.text();
    return new NextResponse(respBody, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    return NextResponse.json(
      {
        error: `백엔드 API 연결 실패 (${HUMA_UPSTREAM_BASE}). i7 pm2·Cloudflare Tunnel·git pull 확인.${detail ? ` (${detail})` : ''}`,
      },
      { status: 502 },
    );
  }
}
