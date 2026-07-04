import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { isGoogleImagenEnabled, isHaikuSubEnabled } from '../../lib/human-engine-policy.js';
import { uploadHumaMediaJpeg } from '../../lib/huma-media-storage.js';

const IMAGEN_NO_PEOPLE_SUFFIX =
  'No people, no human figures, no faces, no hands, no silhouettes, no body parts, no portraits. Still life and symbolic objects only.';

/** Claude가 생성한 image_prompt → Imagen 4용 영문 요약 (Haiku). 모델 선택과 별도. */
export async function prepareImagenPrompt(rawPrompt: string): Promise<string> {
  const trimmed = rawPrompt.trim();
  if (!trimmed) return IMAGEN_NO_PEOPLE_SUFFIX;

  if (!(await isHaikuSubEnabled())) {
    return `${trimmed}. ${IMAGEN_NO_PEOPLE_SUFFIX}`;
  }

  try {
    const model = (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001';
    const raw = await askClaudeWithModel({
      model,
      max_tokens: 220,
      prompt: `아래 이미지 주제를 Google Imagen 4용 영문 프롬프트 한 단락으로 요약해줘 (120단어 이내).

원문:
"${trimmed.slice(0, 600)}"

필수 규칙:
- still life, symbolic objects, scenery만 — 사람·얼굴·손·상반신·실루엣·인체 어떤 형태도 금지
- text, logo, watermark 금지
- 9:16 vertical cinematic mood
- 영문 프롬프트만 출력 (따옴표·설명 없이)`,
    });
    const out = raw?.trim().replace(/^["']|["']$/g, '') ?? '';
    if (!out) return `${trimmed}. ${IMAGEN_NO_PEOPLE_SUFFIX}`;
    if (/no people|no human|still life/i.test(out)) return out;
    return `${out} ${IMAGEN_NO_PEOPLE_SUFFIX}`;
  } catch {
    return `${trimmed}. ${IMAGEN_NO_PEOPLE_SUFFIX}`;
  }
}

/** v3.26 §7-2 — Google Imagen 4 (이미지 전용) */
export type ImagenModel =
  | 'imagen-4.0-fast-generate-001'
  | 'imagen-4.0-generate-001';

const FAST: ImagenModel = 'imagen-4.0-fast-generate-001';
const STANDARD: ImagenModel = 'imagen-4.0-generate-001';

const LEGACY_TO_IMAGEN: Record<string, ImagenModel> = {
  'gpt-image-2': FAST,
  'gpt-image-1.5': FAST,
  'nano-banana-pro': FAST,
  'nano-banana-2': FAST,
  'higgsfield-soul-2': FAST,
  'higgsfield-soul-cinema': STANDARD,
  'flux2': STANDARD,
  'topaz': STANDARD,
};

/** Haiku 자동 판단 — 텍스트·배너는 Standard, 일반 포토는 Fast */
export async function selectImagenModel(prompt: string): Promise<ImagenModel> {
  const override = process.env.IMAGEN_MODEL?.trim() as ImagenModel | undefined;
  if (override === FAST || override === STANDARD) return override;

  if (!(await isHaikuSubEnabled())) return FAST;

  try {
    const raw = await askClaudeWithModel({
      model: (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      prompt: `아래 이미지 생성 프롬프트를 보고 모델을 골라줘.
프롬프트: "${prompt.slice(0, 400)}"
규칙:
- 텍스트·문자·배너·로고·제목 포함 → "standard"
- 그 외 일반 사진·배경·장면 → "fast"
단어 하나만 출력.`,
    });
    return raw?.trim().toLowerCase() === 'standard' ? STANDARD : FAST;
  } catch {
    return FAST;
  }
}

function resolveModel(model: string | undefined, prompt: string): Promise<ImagenModel> {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === 'auto') return selectImagenModel(prompt);
  if (trimmed === FAST || trimmed === STANDARD) return Promise.resolve(trimmed);
  if (LEGACY_TO_IMAGEN[trimmed]) return Promise.resolve(LEGACY_TO_IMAGEN[trimmed]);
  if (trimmed.startsWith('imagen-')) return Promise.resolve(trimmed as ImagenModel);
  return selectImagenModel(prompt);
}

async function saveBase64Image(b64: string, model: ImagenModel): Promise<string> {
  const buf = Buffer.from(b64, 'base64');
  const tmpDir = join(process.cwd(), 'tmp', 'images');
  await mkdir(tmpDir, { recursive: true });
  const localPath = join(tmpDir, `imagen_${Date.now()}.jpg`);
  await writeFile(localPath, buf);

  const fileName = `images/${Date.now()}_${model.replace(/\./g, '_')}.jpg`;
  return uploadHumaMediaJpeg(fileName, buf);
}

export async function generateImage(params: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
}): Promise<string> {
  if (!(await isGoogleImagenEnabled())) {
    throw new Error('Google Imagen 4 API 비활성 (환경 설정 또는 GOOGLE_AI_API_KEY 확인)');
  }
  const apiKey = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY 없음 (Imagen 4 이미지 생성)');

  const model = await resolveModel(params.model, params.prompt);
  const aspectRatio = params.aspectRatio || '9:16';
  const prompt = await prepareImagenPrompt(params.prompt);

  // Gemini Developer API — Imagen 4는 :predict (generateImages 아님 → 404)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio,
        },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Imagen API 실패 (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    generatedImages?: Array<{ image?: { imageBytes?: string } }>;
  };

  const b64 =
    data.predictions?.[0]?.bytesBase64Encoded ??
    data.generatedImages?.[0]?.image?.imageBytes;
  if (!b64) throw new Error('Imagen 응답에 imageBytes 없음');

  return saveBase64Image(b64, model);
}

/** 워크스페이스 기본 — 상세 모델은 generateImage 시 Haiku 판단 */
export function selectImageModelForWorkspace(_workspace: string): string {
  return FAST;
}
