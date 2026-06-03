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

/** i7: 슬롯 6·7 SOCKS 순차 probe(8초×2) + DB */
const UPSTREAM_MS = 25_000;
const HANDLER_MS = 28_000;

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
        ? `i7 무응답(${UPSTREAM_MS / 1000}초, SOCKS probe hang 가능)`
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

/** 브라우저는 localhost만 호출 — Next가 i7로 프록시(rewrite는 타임아웃 불가) */
export async function GET(request: NextRequest) {
  const token = request.headers.get('x-huma-key');
  return Promise.race([
    proxyScheduler(token),
    new Promise<NextResponse>((resolve) =>
      setTimeout(
        () =>
          resolve(
            NextResponse.json(
              {
                error: `프록시 시간 초과(${HANDLER_MS / 1000}초). i7 스케줄러(SOCKS probe) 재배포 필요.`,
              },
              { status: 504 },
            ),
          ),
        HANDLER_MS,
      ),
    ),
  ]);
}
