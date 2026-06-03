import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

const UPSTREAM_MS = 18_000;
const HANDLER_MS = 20_000;

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-huma-key');
  const probe = request.nextUrl.searchParams.get('probe');
  const upstreamUrl =
    probe === '1'
      ? `${API_BASE}/api/crank/scheduler?probe=1`
      : `${API_BASE}/api/crank/scheduler`;
  const upstreamMs = probe === '1' ? UPSTREAM_MS : 8_000;
  const handlerMs = probe === '1' ? HANDLER_MS : 10_000;

  async function proxySchedulerWithUrl(): Promise<NextResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), upstreamMs);
    try {
      const upstream = await fetch(upstreamUrl, {
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
          ? `i7 무응답(${upstreamMs / 1000}초)`
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

  return Promise.race([
    proxySchedulerWithUrl(),
    new Promise<NextResponse>((resolve) =>
      setTimeout(
        () =>
          resolve(
            NextResponse.json(
              { error: `프록시 시간 초과(${handlerMs / 1000}초). i7 스케줄러 응답 없음.` },
              { status: 504 },
            ),
          ),
        handlerMs,
      ),
    ),
  ]);
}
