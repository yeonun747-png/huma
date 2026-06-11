import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function loadWebEnv(): void {
  const cwd = process.cwd();
  const webRoot = existsSync(join(cwd, 'apps', 'web', '.env.local'))
    ? join(cwd, 'apps', 'web')
    : cwd;
  loadEnvConfig(webRoot);
}

loadWebEnv();

const API_BASE =
  process.env.HUMA_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_HUMA_API_URL?.trim() ||
  'http://localhost:3100';

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-huma-key');
  const upstreamUrl = `${API_BASE}/api/crank/feed${request.nextUrl.search}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: token ? { 'X-HUMA-KEY': token } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    return NextResponse.json(
      { error: `백엔드 API 실패 (${API_BASE})${detail ? `: ${detail}` : ''}` },
      { status: 502 },
    );
  }
}
