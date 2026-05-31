import { NextRequest, NextResponse } from 'next/server';

const API_BASE =
  process.env.HUMA_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_HUMA_API_URL?.trim() ||
  'http://localhost:3100';

/** 브라우저 광고 차단 회피 — romang-ai.com 동일 출처에서 i7 API로 프록시 */
export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get('workspace') ?? 'quizoasis';
  const token = request.headers.get('x-huma-key');

  try {
    const upstream = await fetch(
      `${API_BASE}/api/monetization/stats?workspace=${encodeURIComponent(workspace)}`,
      {
        headers: token ? { 'X-HUMA-KEY': token } : {},
        cache: 'no-store',
      },
    );

    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: `백엔드 API 연결 실패 (${API_BASE}). i7 서버·Tunnel 상태를 확인하세요.` },
      { status: 502 },
    );
  }
}
