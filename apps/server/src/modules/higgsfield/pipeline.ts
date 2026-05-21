import { supabase } from '../../middleware/auth.js';

import { downloadFile } from '../../lib/utils.js';

import { logOperation } from '../../lib/log-emitter.js';

import { enqueueHumaJob, type JobRecord } from '../../lib/job-scheduler.js';

import { generateImage, type ImageModel } from './image.js';

import { generateVideo, type VideoModel } from './video.js';

import { generateTTS, type TTSModel } from './tts.js';

import { mergeWithFFmpeg } from './ffmpeg.js';

import { generateLipsync } from './lipsync.js';

import { selectBgm } from '../bgm/selector.js';

import { uploadTikTokVideo, uploadInstagramReel } from '../social-api/index.js';

import { buildVideoLinks } from '../queue/jobs/content-orchestrator.js';

import { join } from 'path';

import { askClaude } from '../../lib/anthropic-client.js';



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

    const reply = await askClaude(

      `스크립트의 무드를 분석해서 1개만 JSON으로 답해. mood는 calm/romantic/mysterious/energetic/inspiring/dark/playful/emotional/dramatic 중 하나.\n스크립트: ${text.slice(0, 300)}\n{"mood":""}`

    );

    if (reply) return JSON.parse(reply).mood ?? 'calm';

  } catch {

    // fallback

  }

  return 'calm';

}



async function resumePausedJob(jobId: string, contentAppend?: string) {

  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).single();

  if (!job) return;



  const nextContent = contentAppend ? `${job.content ?? ''}${contentAppend}` : job.content;

  await supabase

    .from('huma_jobs')

    .update({ content: nextContent, status: 'pending' })

    .eq('id', jobId);



  const { data: updated } = await supabase.from('huma_jobs').select('*').eq('id', jobId).single();

  if (updated) await enqueueHumaJob(updated as JobRecord);

}



async function finalizeTypeBJobs(

  videoJob: Record<string, unknown>,

  tiktokUrl?: string,

  instagramUrl?: string,

) {

  const links = buildVideoLinks(tiktokUrl, instagramUrl);

  if (videoJob.blog_job_id) {

    await resumePausedJob(String(videoJob.blog_job_id), links);

  }

  if (videoJob.threads_job_id && tiktokUrl) {

    await resumePausedJob(String(videoJob.threads_job_id), `\n\n${tiktokUrl}`);

  }

  if (videoJob.twitter_job_id && tiktokUrl) {

    await resumePausedJob(String(videoJob.twitter_job_id), `\n\n${tiktokUrl}`);

  }

}



export async function runVideoPipeline(videoJobId: string) {

  const job = await getVideoJob(videoJobId);

  const tmpDir = join(process.cwd(), 'tmp', 'videos');



  try {

    let imageUrl = job.generated_image_url as string | undefined;

    if (!imageUrl) {

      await updateStep(videoJobId, 'image_generating');

      imageUrl = await generateImage({

        prompt: job.image_prompt,

        model: job.image_model as ImageModel,

      });

      await updateVideoJob(videoJobId, { generated_image_url: imageUrl });

    }



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

    const platforms = (job.upload_platforms ?? []) as string[];

    let tiktokUrl: string | undefined;

    let instagramUrl: string | undefined;



    if (platforms.includes('tiktok')) {

      tiktokUrl = await uploadTikTokVideo({

        workspace: job.workspace,

        videoPath: outputPath,

        caption: job.caption ?? '',

        hashtags: job.hashtags ?? [],

      });

    }

    if (platforms.includes('instagram')) {

      instagramUrl = await uploadInstagramReel({

        workspace: job.workspace,

        videoPath: outputPath,

        caption: job.caption ?? '',

        hashtags: job.hashtags ?? [],

      });

    }



    await updateVideoJob(videoJobId, {

      tiktok_result_url: tiktokUrl ?? null,

      instagram_result_url: instagramUrl ?? null,

    });



    if (job.blog_job_id) {

      await finalizeTypeBJobs(job, tiktokUrl, instagramUrl);

    }



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

