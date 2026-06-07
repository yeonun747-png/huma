import { NextRequest } from 'next/server';

import { proxyToHumaApi } from '@/lib/huma-api-proxy';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  return proxyToHumaApi(request, '/api/system/telegram-test');
}
