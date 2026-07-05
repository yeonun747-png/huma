import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  parseQuizImagePrompts,
  normalizeQuizImagePrefix,
  type QuizImagePromptItem,
} from '@huma/shared';
import { authMiddleware, getWorkspaceFilter } from '../middleware/auth.js';
import {
  createStoredZip,
  fetchQuizImagePngBytes,
  fetchQuizImagesForZip,
  generateQuizImage,
  hasEvoLinkApiKey,
  QUIZ_IMAGE_DEFAULTS,
} from '../modules/quiz-images/evolink-image.js';

function assertQuizOasisAccess(request: FastifyRequest, reply: FastifyReply): boolean {
  const allowed = getWorkspaceFilter(request);
  if (!allowed.includes('quizoasis')) {
    void reply.code(403).send({ error: '퀴즈오아시스 접근 권한 없음' });
    return false;
  }
  return true;
}

export async function registerQuizImageRoutes(app: FastifyInstance) {
  const routeOpts = { preHandler: authMiddleware };

  app.get('/api/quiz-images/config', routeOpts, async (request, reply) => {
    if (!assertQuizOasisAccess(request, reply)) return;
    return {
      configured: hasEvoLinkApiKey(),
      defaults: QUIZ_IMAGE_DEFAULTS,
    };
  });

  app.post('/api/quiz-images/parse', routeOpts, async (request, reply) => {
    if (!assertQuizOasisAccess(request, reply)) return;
    const body = request.body as { raw?: string; prefix?: string };
    const raw = String(body.raw ?? '');
    const prefix = normalizeQuizImagePrefix(String(body.prefix ?? ''));
    if (!raw.trim()) {
      return reply.code(400).send({ error: '붙여넣을 텍스트가 없습니다' });
    }
    if (!prefix) {
      return reply.code(400).send({ error: '파일명 프리픽스를 입력하세요 (예: p3_test_solo_drinking_type)' });
    }
    return parseQuizImagePrompts(raw, prefix);
  });

  app.post('/api/quiz-images/generate', routeOpts, async (request, reply) => {
    if (!assertQuizOasisAccess(request, reply)) return;
    if (!hasEvoLinkApiKey()) {
      return reply.code(503).send({ error: 'EVOLINK_API_KEY가 설정되지 않았습니다' });
    }

    const body = request.body as {
      prompt?: string;
      filename?: string;
      questionNumber?: number;
      choiceId?: string | null;
    };
    const prompt = String(body.prompt ?? '').trim();
    const filename = String(body.filename ?? '').trim();
    if (!prompt) return reply.code(400).send({ error: 'prompt 필요' });
    if (!filename) return reply.code(400).send({ error: 'filename 필요' });

    try {
      const { taskId, imageUrl } = await generateQuizImage(prompt);
      return {
        ok: true,
        taskId,
        imageUrl,
        filename,
        questionNumber: body.questionNumber ?? null,
        choiceId: body.choiceId ?? null,
      };
    } catch (err) {
      request.log.error({ err }, 'quiz image generate failed');
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/quiz-images/download', routeOpts, async (request, reply) => {
    if (!assertQuizOasisAccess(request, reply)) return;
    const q = request.query as { url?: string; filename?: string };
    const url = String(q.url ?? '').trim();
    const filename = String(q.filename ?? 'quiz-image.png').trim();
    if (!/^https?:\/\//i.test(url)) {
      return reply.code(400).send({ error: '유효한 url 필요' });
    }
    try {
      const data = await fetchQuizImagePngBytes(url);
      return reply
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
        .send(data);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/quiz-images/download', routeOpts, async (request, reply) => {
    if (!assertQuizOasisAccess(request, reply)) return;
    const body = request.body as { url?: string; filename?: string };
    const url = String(body.url ?? '').trim();
    const filename = String(body.filename ?? 'quiz-image.png').trim();
    if (!/^https?:\/\//i.test(url)) {
      return reply.code(400).send({ error: '유효한 url 필요' });
    }
    try {
      const data = await fetchQuizImagePngBytes(url);
      return reply
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
        .send(data);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/quiz-images/zip', routeOpts, async (request, reply) => {
    if (!assertQuizOasisAccess(request, reply)) return;
    const body = request.body as {
      items?: Array<{ url: string; filename: string }>;
      zipName?: string;
    };
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return reply.code(400).send({ error: '다운로드할 이미지가 없습니다' });
    }

    try {
      const files = await fetchQuizImagesForZip(items);
      if (files.length === 0) {
        return reply.code(400).send({ error: '유효한 이미지 URL이 없습니다' });
      }
      const zip = createStoredZip(files);
      const zipName = String(body.zipName ?? 'quiz-images.zip').replace(/[^\w.-]/g, '_');
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${zipName}"`)
        .send(zip);
    } catch (err) {
      request.log.error({ err }, 'quiz image zip failed');
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}

export type { QuizImagePromptItem };
