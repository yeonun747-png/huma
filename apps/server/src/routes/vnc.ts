import type { FastifyInstance, FastifyRequest } from 'fastify';
import { join } from 'path';
import { readFileSync } from 'fs';
import { buildVncHudState, clearVncFocus, focusVncByHotkey } from '../lib/vnc-focus.js';

const PORT = Number(process.env.PORT) || 3100;

function isVncLocalRequest(request: FastifyRequest): boolean {
  const ip = request.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1');
}

function assertVncLocal(request: FastifyRequest) {
  if (!isVncLocalRequest(request)) {
    throw new Error('FORBIDDEN');
  }
}

export async function registerVncRoutes(app: FastifyInstance) {
  app.get('/api/vnc/hud', async (request, reply) => {
    assertVncLocal(request);
    return buildVncHudState();
  });

  app.post<{ Params: { slot: string } }>('/api/vnc/focus/:slot', async (request, reply) => {
    assertVncLocal(request);
    const result = await focusVncByHotkey(request.params.slot);
    if (!result) {
      return reply.code(400).send({ error: 'unknown slot', slot: request.params.slot });
    }
    return { ok: true, ...result, hud: await buildVncHudState() };
  });

  app.post('/api/vnc/layout/tile', async (request, reply) => {
    assertVncLocal(request);
    await clearVncFocus();
    return { ok: true, hud: await buildVncHudState() };
  });

  app.get('/vnc-hud', async (request, reply) => {
    assertVncLocal(request);
    const htmlPath = join(process.cwd(), 'deploy', 'vnc-hud.html');
    const html = readFileSync(htmlPath, 'utf8').replace('__HUMA_PORT__', String(PORT));
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
