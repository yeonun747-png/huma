import { execFile } from 'child_process';
import { copyFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { generateImage } from '../higgsfield/image.js';
import { uploadInstagramReel } from '../social-api/index.js';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';

const execFileAsync = promisify(execFile);

export type QuizOasisIgVariant = 'EN' | 'KR';

export interface VariantResult {
  videoPath: string;
  thumbnailUrl: string;
  account: QuizOasisIgVariant;
  caption: string;
}

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

/** v3.25 §7-10-2 ④ — EN/KR IG 캡션 Haiku 변형 (동일 문구 금지) */
export async function generateAccountCaption(
  baseCaption: string,
  account: QuizOasisIgVariant,
): Promise<string> {
  const trimmed = baseCaption.trim();
  if (!trimmed || !process.env.ANTHROPIC_API_KEY) return trimmed;

  const prompt =
    account === 'EN'
      ? `Rewrite this Korean caption into natural English for Instagram Reels.
Keep the same meaning but use different phrasing.
Original: "${trimmed}"
Rules: 1~2 sentences, casual tone, 1~2 emojis max. Caption only.`
      : `아래 캡션을 다른 말투와 표현으로 자연스럽게 다시 써줘.
같은 내용이지만 다른 어휘와 문체 사용.
원본: "${trimmed}"
규칙: 1~2문장, 구어체, 이모지 1~2개. 캡션만 출력.`;

  try {
    const raw = await askClaudeWithModel({
      model: (await getSubClaudeModel()) || HAIKU_FALLBACK,
      max_tokens: 200,
      prompt,
    });
    return raw?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

/** v3.21 §7-10-2 + v3.25 캡션 변형 — IG EN/KR 중복 방지 */
export async function prepareAccountVariant(
  videoPath: string,
  account: QuizOasisIgVariant,
  testSlug: string,
  baseCaption = '',
): Promise<VariantResult> {
  const tmpDir = join(process.cwd(), 'tmp', 'quizoasis-variants');
  await mkdir(tmpDir, { recursive: true });

  const thumbnailPrompt =
    account === 'EN'
      ? 'Quiz thumbnail: bold text "Check this out!" on dark background, QuizOasis branding'
      : 'Quiz thumbnail: bold Korean text "지금 바로 확인!" on dark background, QuizOasis branding';
  const thumbnailUrl = await generateImage({ prompt: thumbnailPrompt });

  const outputPath = join(tmpDir, `quizoasis_${account}_${testSlug}.mp4`);
  if (account === 'KR') {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        videoPath,
        '-itsoffset',
        '0.5',
        '-i',
        videoPath,
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-c:v',
        'copy',
        '-shortest',
        outputPath,
      ],
      { timeout: 120_000 },
    );
  } else {
    await copyFile(videoPath, outputPath);
  }

  const caption = baseCaption ? await generateAccountCaption(baseCaption, account) : '';

  return { videoPath: outputPath, thumbnailUrl, account, caption };
}

/** v3.21 §7-10-1 — TikTok 7개 언어 해시태그 (한 번에 발행) */
export function buildQuizOasisTikTokHashtags(extra: string[] = []): string[] {
  const base = [
    'mbti',
    'personalitytest',
    'truembti',
    'aianalysis',
    'psychology',
    'quizoasis',
    'MBTI',
    '성격테스트',
    '심리테스트',
    '성격유형',
    '진짜MBTI',
    '性格診断',
    '心理テスト',
    '本当の性格',
    '性格测试',
    '心理测试',
    '真实性格',
    '性格測驗',
    '心理測驗',
    '真實性格',
    'mbtivietnam',
    'tracnghiemtinhcach',
    'tinhcach',
    'tesmbti',
    'teskepribadian',
    'mbtiindonesia',
    'psikologi',
  ];
  return [...new Set([...base, ...extra.map((h) => h.replace(/^#/, ''))])];
}

export async function uploadQuizOasisInstagramVariants(params: {
  workspace: string;
  videoPath: string;
  caption: string;
  hashtags: string[];
  testSlug: string;
}): Promise<{ en?: string; kr?: string }> {
  const enVariant = await prepareAccountVariant(
    params.videoPath,
    'EN',
    params.testSlug,
    params.caption,
  );
  const krVariant = await prepareAccountVariant(
    params.videoPath,
    'KR',
    params.testSlug,
    params.caption,
  );

  const enHashtags = params.hashtags.length ? params.hashtags : buildQuizOasisTikTokHashtags().slice(0, 8);
  const krHashtags = params.hashtags.length
    ? params.hashtags
    : ['MBTI', '성격테스트', '심리테스트', '성격유형', '진짜MBTI', 'quizoasis'];

  const [en, kr] = await Promise.allSettled([
    uploadInstagramReel({
      workspace: params.workspace,
      platform: 'instagram_en',
      videoPath: enVariant.videoPath,
      caption: enVariant.caption || params.caption,
      hashtags: enHashtags,
    }),
    uploadInstagramReel({
      workspace: params.workspace,
      platform: 'instagram_kr',
      videoPath: krVariant.videoPath,
      caption: krVariant.caption || params.caption,
      hashtags: krHashtags,
    }),
  ]);

  return {
    en: en.status === 'fulfilled' ? en.value : undefined,
    kr: kr.status === 'fulfilled' ? kr.value : undefined,
  };
}
