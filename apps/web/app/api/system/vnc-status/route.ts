import { NextRequest } from 'next/server';

import { proxyToHumaApi } from '@/lib/huma-api-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return proxyToHumaApi(request, '/api/system/vnc-status');
}
