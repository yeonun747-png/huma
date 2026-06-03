import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

/** i7: 슬롯 6·7 SOCKS 병렬 probe(~10초) + DB */
const UPSTREAM_MS = 30_000;
const HANDLER_MS = 32_000;

async function proxyScheduler(token: string | null): Promise<NextResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_MS);
  try {
    const upstream = await fetch(`${API_BASE}/api/crank/scheduler`, {
      headers: token ? { 'X-HUMA-KEY': token } : {},
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const detail =
      err instanceof Error && err.name === 'AbortError'
        ? `i7 무응답(${UPSTREAM_MS / 1000}초)`
        : err instanceof Error
          ? err.message
          : '';
    return NextResponse.json(
      { error: `백엔드 API 실패 (${API_BASE})${detail ? `: ${detail}` : ''}` },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-huma-key');
  return Promise.race([
    proxyScheduler(token),
    new Promise<NextResponse>((resolve) =>
      setTimeout(
        () =>
          resolve(
            NextResponse.json(
              { error: `프록시 시간 초과(${HANDLER_MS / 1000}초). i7 스케줄러 응답 없음.` },
              { status: 504 },
            ),
          ),
        HANDLER_MS,
      ),
    ),
  ]);
}
