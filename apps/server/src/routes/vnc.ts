import type { FastifyInstance, FastifyRequest } from 'fastify';
import { join } from 'path';
import { readFileSync } from 'fs';
import { buildVncHudState, clearVncFocus, focusVncByHotkey } from '../lib/vnc-focus.js';
import { refreshAllVncWindowLayouts } from '../lib/vnc-window-guard.js';
import {
  getVncImeStatus,
  setVncImeEnglish,
  setVncImeHangul,
  toggleVncIme,
} from '../lib/vnc-ime.js';

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
    const hud = await buildVncHudState();
    const ime = await getVncImeStatus();
    return { ...hud, ime };
  });

  app.get('/api/vnc/ime', async (request) => {
    assertVncLocal(request);
    return getVncImeStatus();
  });

  app.post('/api/vnc/ime/toggle', async (request) => {
    assertVncLocal(request);
    return toggleVncIme();
  });

  app.post('/api/vnc/ime/hangul', async (request) => {
    assertVncLocal(request);
    return setVncImeHangul();
  });

  app.post('/api/vnc/ime/english', async (request) => {
    assertVncLocal(request);
    return setVncImeEnglish();
  });

  app.post<{ Params: { slot: string } }>('/api/vnc/focus/:slot', async (request, reply) => {
    assertVncLocal(request);
    const result = await focusVncByHotkey(request.params.slot);
    if (!result) {
      return reply.code(400).send({ error: 'unknown slot', slot: request.params.slot });
    }
    const windows = await refreshAllVncWindowLayouts();
    return { ok: true, ...result, windows, hud: await buildVncHudState() };
  });

  app.post('/api/vnc/layout/tile', async (request, reply) => {
    assertVncLocal(request);
    await clearVncFocus();
    const windows = await refreshAllVncWindowLayouts();
    return { ok: true, windows, hud: await buildVncHudState() };
  });

  app.get('/vnc-hud', async (request, reply) => {
    assertVncLocal(request);
    const htmlPath = join(process.cwd(), 'deploy', 'vnc-hud.html');
    const html = readFileSync(htmlPath, 'utf8').replace('__HUMA_PORT__', String(PORT));
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
