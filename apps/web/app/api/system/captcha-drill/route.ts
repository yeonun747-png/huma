import { NextRequest } from 'next/server';

import { proxyToHumaApi } from '@/lib/huma-api-proxy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return proxyToHumaApi(request, '/api/system/captcha-drill');
}

export async function POST(request: NextRequest) {
  return proxyToHumaApi(request, '/api/system/captcha-drill', { timeoutMs: 55_000 });
}
