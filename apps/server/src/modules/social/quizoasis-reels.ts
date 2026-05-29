import { execFile } from 'child_process';
import { copyFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { generateImage } from '../higgsfield/image.js';
import { uploadInstagramReel } from '../social-api/index.js';

const execFileAsync = promisify(execFile);

export type QuizOasisIgVariant = 'EN' | 'KR';

export interface VariantResult {
  videoPath: string;
  thumbnailUrl: string;
  account: QuizOasisIgVariant;
}

/** v3.21 §7-10-2 — IG EN/KR 계정 중복 콘텐츠 방지 (썸네일·오디오·해시태그 분리) */
export async function prepareAccountVariant(
  videoPath: string,
  account: QuizOasisIgVariant,
  testSlug: string,
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

  return { videoPath: outputPath, thumbnailUrl, account };
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
  const enVariant = await prepareAccountVariant(params.videoPath, 'EN', params.testSlug);
  const krVariant = await prepareAccountVariant(params.videoPath, 'KR', params.testSlug);

  const enHashtags = params.hashtags.length ? params.hashtags : buildQuizOasisTikTokHashtags().slice(0, 8);
  const krHashtags = params.hashtags.length
    ? params.hashtags
    : ['MBTI', '성격테스트', '심리테스트', '성격유형', '진짜MBTI', 'quizoasis'];

  const [en, kr] = await Promise.allSettled([
    uploadInstagramReel({
      workspace: params.workspace,
      platform: 'instagram_en',
      videoPath: enVariant.videoPath,
      caption: params.caption,
      hashtags: enHashtags,
    }),
    uploadInstagramReel({
      workspace: params.workspace,
      platform: 'instagram_kr',
      videoPath: krVariant.videoPath,
      caption: params.caption,
      hashtags: krHashtags,
    }),
  ]);

  return {
    en: en.status === 'fulfilled' ? en.value : undefined,
    kr: kr.status === 'fulfilled' ? kr.value : undefined,
  };
}
