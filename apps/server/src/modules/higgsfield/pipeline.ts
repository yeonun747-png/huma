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
import { uploadYouTubeShorts } from '../social-api/youtube.js';

import { buildBlogVideoAppend } from '../queue/jobs/content-orchestrator.js';

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

  const moods = ['upbeat', 'calm', 'mysterious', 'emotional', 'energetic', 'cinematic', 'lofi'];

  if (!process.env.ANTHROPIC_API_KEY) {

    return moods[Math.floor(Math.random() * moods.length)];

  }

  try {

    const reply = await askClaude(

      `스크립트의 BGM 분류를 분석해서 1개만 JSON으로 답해. category는 upbeat/calm/mysterious/emotional/energetic/cinematic/lofi 중 하나.\n스크립트: ${text.slice(0, 300)}\n{"category":""}`

    );

    if (reply) {
      const parsed = JSON.parse(reply) as { category?: string; mood?: string };
      return parsed.category ?? parsed.mood ?? 'calm';
    }

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

  youtubeUrl?: string,

) {

  let blogTitle = String(videoJob.caption ?? 'HUMA Short');

  if (videoJob.blog_job_id) {

    const { data: blogJob } = await supabase

      .from('huma_jobs')

      .select('title')

      .eq('id', videoJob.blog_job_id)

      .maybeSingle();

    if (blogJob?.title) blogTitle = blogJob.title;

  }

  const links = buildBlogVideoAppend(blogTitle, tiktokUrl, instagramUrl, youtubeUrl);

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

    let bgmPath: string | null = null;

    try {

      bgmPath = await selectBgm({

        workspace: job.workspace,

        contentMood: mood,

        videoDurationSec: job.duration_sec,

        platform: job.upload_platforms?.[0] ?? 'tiktok',

      });

      if (bgmPath) await updateVideoJob(videoJobId, { bgm_url: bgmPath });

    } catch {

      // BGM 없이 영상 생성 계속

    }



    await updateStep(videoJobId, 'ffmpeg_merging');

    const outputPath = join(tmpDir, `${videoJobId}_final.mp4`);

    await mergeWithFFmpeg({

      videoPath: await downloadFile(lipsyncVideoUrl, join(tmpDir, `${videoJobId}_video.mp4`)),

      audioPath: audioUrl ? await downloadFile(audioUrl, join(tmpDir, `${videoJobId}_tts.mp3`)) : null,

      bgmPath,

      outputPath,

      bgmVolume: 0.3,

    });

    await updateVideoJob(videoJobId, { output_video_path: outputPath });



    await updateStep(videoJobId, 'uploading');

    const platforms = (job.upload_platforms ?? []) as string[];

    let blogTitle = job.caption ?? 'HUMA Short';

    let blogDescription = String(job.caption ?? '').slice(0, 500);

    if (job.blog_job_id) {

      const { data: blogJob } = await supabase

        .from('huma_jobs')

        .select('title, content')

        .eq('id', job.blog_job_id)

        .maybeSingle();

      if (blogJob?.title) blogTitle = blogJob.title;

      if (blogJob?.content) blogDescription = String(blogJob.content).slice(0, 500);

    }

    const uploadTasks: Array<{
      key: 'tiktok' | 'instagram' | 'youtube';
      run: () => Promise<string | undefined>;
    }> = [];

    if (platforms.includes('tiktok')) {
      uploadTasks.push({
        key: 'tiktok',
        run: () =>
          uploadTikTokVideo({
            workspace: job.workspace,
            videoPath: outputPath,
            caption: job.caption ?? '',
            hashtags: job.hashtags ?? [],
          }),
      });
    }
    if (platforms.includes('instagram')) {
      uploadTasks.push({
        key: 'instagram',
        run: () =>
          uploadInstagramReel({
            workspace: job.workspace,
            videoPath: outputPath,
            caption: job.caption ?? '',
            hashtags: job.hashtags ?? [],
          }),
      });
    }
    if (platforms.includes('youtube')) {
      uploadTasks.push({
        key: 'youtube',
        run: () =>
          uploadYouTubeShorts({
            workspace: job.workspace,
            videoPath: outputPath,
            title: String(blogTitle),
            description: blogDescription,
            hashtags: [...(job.hashtags ?? []), 'Shorts'],
          }),
      });
    }

    const uploadResults = await Promise.allSettled(uploadTasks.map((t) => t.run()));
    const urls: Partial<Record<'tiktok' | 'instagram' | 'youtube', string | undefined>> = {};
    uploadTasks.forEach((task, i) => {
      const result = uploadResults[i];
      urls[task.key] = result.status === 'fulfilled' ? result.value : undefined;
    });

    const tiktokUrl = urls.tiktok;
    const instagramUrl = urls.instagram;
    const youtubeUrl = urls.youtube;

    await updateVideoJob(videoJobId, {

      tiktok_result_url: tiktokUrl ?? null,

      instagram_result_url: instagramUrl ?? null,

      youtube_result_url: youtubeUrl ?? null,

    });

    if (job.blog_job_id) {

      await finalizeTypeBJobs(job, tiktokUrl, instagramUrl, youtubeUrl);

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

