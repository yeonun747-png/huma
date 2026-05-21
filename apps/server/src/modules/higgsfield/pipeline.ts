import { supabase } from '../../middleware/auth.js';
import { downloadFile } from '../../lib/utils.js';
import { logOperation } from '../../lib/log-emitter.js';
import { generateImage, type ImageModel } from './image.js';
import { generateVideo, type VideoModel } from './video.js';
import { generateTTS, type TTSModel } from './tts.js';
import { mergeWithFFmpeg } from './ffmpeg.js';
import { generateLipsync } from './lipsync.js';
import { selectBgm } from '../bgm/selector.js';
import { uploadToPlatform } from '../social-api/index.js';
import { join } from 'path';
import { createAnthropicClient } from '../../lib/anthropic-client.js';

async function getVideoJob(id: string) {
  const { data } = await supabase.from('huma_video_queue').select('*').eq('id', id).single();
  if (!data) throw new Error('영상 작업 없음');
  return data;
}

async function updateStep(id: string, step: string) {
  await supabase.from('huma_video_queue').update({ current_step: step, status: step }).eq('id', id);
}

async function updateVideoJob(id: string, fields: Record<string, unknown>) {
  await supabase
    .from('huma_video_queue')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
}

async function analyzeContentMood(text: string): Promise<string> {
  const moods = ['calm', 'romantic', 'mysterious', 'energetic', 'inspiring', 'dark', 'playful', 'emotional', 'dramatic'];
  if (!process.env.ANTHROPIC_API_KEY) {
    return moods[Math.floor(Math.random() * moods.length)];
  }
  try {
    const client = createAnthropicClient();
    if (!client) return moods[Math.floor(Math.random() * moods.length)];
    const res = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `스크립트의 무드를 분석해서 1개만 JSON으로 답해. mood는 calm/romantic/mysterious/energetic/inspiring/dark/playful/emotional/dramatic 중 하나.\n스크립트: ${text.slice(0, 300)}\n{"mood":""}`,
      }],
    });
    const block = res.content[0];
    if (block.type === 'text') {
      return JSON.parse(block.text).mood ?? 'calm';
    }
  } catch {
    // fallback
  }
  return 'calm';
}

export async function runVideoPipeline(videoJobId: string) {
  const job = await getVideoJob(videoJobId);
  const tmpDir = join(process.cwd(), 'tmp', 'videos');

  try {
    await updateStep(videoJobId, 'image_generating');
    const imageUrl = await generateImage({
      prompt: job.image_prompt,
      model: job.image_model as ImageModel,
    });
    await updateVideoJob(videoJobId, { generated_image_url: imageUrl });

    await updateStep(videoJobId, 'video_generating');
    const videoUrl = await generateVideo({
      imageUrl,
      prompt: job.video_prompt,
      model: job.video_model as VideoModel,
      durationSec: job.duration_sec,
    });
    await updateVideoJob(videoJobId, { source_video_url: videoUrl });

    await updateStep(videoJobId, 'tts_generating');
    let audioUrl: string | null = null;
    let lipsyncVideoUrl = videoUrl;
    if (job.tts_script) {
      audioUrl = await generateTTS({ script: job.tts_script, model: job.tts_model as TTSModel });
      await updateVideoJob(videoJobId, { tts_audio_url: audioUrl });

      await updateStep(videoJobId, 'lipsync_generating');
      lipsyncVideoUrl = await generateLipsync({ videoUrl, audioUrl });
      await updateVideoJob(videoJobId, { source_video_url: lipsyncVideoUrl });
    }

    const mood = await analyzeContentMood(job.tts_script || job.video_prompt || '');
    const bgmUrl = await selectBgm({
      workspace: job.workspace,
      contentMood: mood,
      videoDurationSec: job.duration_sec,
      platform: job.upload_platforms?.[0] ?? 'tiktok',
    });
    await updateVideoJob(videoJobId, { bgm_url: bgmUrl });

    await updateStep(videoJobId, 'ffmpeg_merging');
    const outputPath = join(tmpDir, `${videoJobId}_final.mp4`);
    await mergeWithFFmpeg({
      videoPath: await downloadFile(lipsyncVideoUrl, join(tmpDir, `${videoJobId}_video.mp4`)),
      audioPath: audioUrl ? await downloadFile(audioUrl, join(tmpDir, `${videoJobId}_tts.mp3`)) : null,
      bgmPath: await downloadFile(bgmUrl, join(tmpDir, `${videoJobId}_bgm.mp3`)),
      outputPath,
      bgmVolume: 0.25,
    });
    await updateVideoJob(videoJobId, { output_video_path: outputPath });

    await updateStep(videoJobId, 'uploading');
    const platforms = job.upload_platforms ?? [];
    await Promise.allSettled(
      platforms.map((platform: string) =>
        uploadToPlatform(platform, {
          workspace: job.workspace,
          videoPath: outputPath,
          caption: job.caption ?? '',
          hashtags: job.hashtags ?? [],
        })
      )
    );

    await updateVideoJob(videoJobId, { status: 'done', current_step: 'done' });
    await logOperation({
      level: 'info',
      message: '영상 파이프라인 완료',
      workspace: job.workspace,
      platform: platforms.join(','),
    });
  } catch (err) {
    await updateVideoJob(videoJobId, {
      status: 'failed',
      error_message: (err as Error).message,
    });
    throw err;
  }
}
