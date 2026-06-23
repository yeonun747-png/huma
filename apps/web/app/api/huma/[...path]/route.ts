import { NextRequest } from 'next/server';
import { proxyToHumaApi } from '@/lib/huma-api-proxy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RouteContext = { params: { path: string[] } };

async function proxy(request: NextRequest, context: RouteContext) {
  const segments = context.params.path ?? [];
  const upstreamPath = `/api/${segments.join('/')}`;
  return proxyToHumaApi(request, upstreamPath, { timeoutMs: 280_000 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}
