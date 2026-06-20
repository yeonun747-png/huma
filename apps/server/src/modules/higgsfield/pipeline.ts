import { supabase } from '../../middleware/auth.js';

import { downloadFile } from '../../lib/utils.js';

import { logOperation } from '../../lib/log-emitter.js';

import { enqueueHumaJob, type JobRecord } from '../../lib/job-scheduler.js';

import { generateImage, type ImageModel } from './image.js';

import { generateVideo, type VideoModel } from './video.js';

import { generateTTS, type TTSModel } from './tts.js';

import { generateLipsync } from './lipsync.js';

import { uploadTikTokVideo, uploadInstagramReel } from '../social-api/index.js';
import { uploadYouTubeShorts } from '../social-api/youtube.js';
import { uploadPinterestVideoPin } from '../social-api/pinterest.js';
import { uploadQuizOasisInstagramVariants } from '../social/quizoasis-reels.js';

import { buildBlogVideoAppend } from '../queue/jobs/content-orchestrator.js';
import { createPausedSocialReplyJob } from '../../lib/social-reply-chain.js';
import { isGoogleImagenEnabled, isHiggsfieldVideoEnabled } from '../../lib/human-engine-policy.js';
import { getPipelineModelSettings } from '../../lib/pipeline-settings.js';

import { copyFile, mkdir } from 'fs/promises';

import { join } from 'path';



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

  // Step 6 (㉝㉞): reply job 먼저 등록 → 본문 발행 완료 시 자동 활성화
  if (videoJob.threads_job_id && tiktokUrl) {
    const { data: parentJob } = await supabase
      .from('huma_jobs')
      .select('workspace, platform_account_id, title')
      .eq('id', videoJob.threads_job_id)
      .maybeSingle();
    if (parentJob?.workspace) {
      await createPausedSocialReplyJob({
        jobType: 'threads_reply',
        workspace: parentJob.workspace,
        platformAccountId: parentJob.platform_account_id,
        parentJobId: String(videoJob.threads_job_id),
        tiktokUrl,
        title: `[threads reply] ${parentJob.title ?? 'TikTok'}`,
      });
    }
  }

  if (videoJob.twitter_job_id && tiktokUrl) {
    const { data: parentJob } = await supabase
      .from('huma_jobs')
      .select('workspace, platform_account_id, title')
      .eq('id', videoJob.twitter_job_id)
      .maybeSingle();
    if (parentJob?.workspace) {
      await createPausedSocialReplyJob({
        jobType: 'twitter_reply',
        workspace: parentJob.workspace,
        platformAccountId: parentJob.platform_account_id,
        parentJobId: String(videoJob.twitter_job_id),
        tiktokUrl,
        title: `[twitter reply] ${parentJob.title ?? 'TikTok'}`,
      });
    }
  }

  if (videoJob.threads_job_id) {
    await resumePausedJob(String(videoJob.threads_job_id));
  }

  if (videoJob.twitter_job_id) {
    await resumePausedJob(String(videoJob.twitter_job_id));
  }
}



export async function runVideoPipeline(videoJobId: string) {

  const job = await getVideoJob(videoJobId);

  const tmpDir = join(process.cwd(), 'tmp', 'videos');



  try {

    let imageUrl = job.generated_image_url as string | undefined;

    if (!imageUrl) {
      if (!(await isGoogleImagenEnabled())) {
        throw new Error('Google Imagen 4 API 비활성 — 이미지 생성 단계 중단');
      }

      await updateStep(videoJobId, 'image_generating');

      const rawImageModel = job.image_model as string | undefined;
      imageUrl = await generateImage({
        prompt: job.image_prompt,
        model:
          rawImageModel && rawImageModel !== 'auto'
            ? (rawImageModel as ImageModel)
            : undefined,
      });

      await updateVideoJob(videoJobId, { generated_image_url: imageUrl });

    }



    if (!(await isHiggsfieldVideoEnabled())) {
      throw new Error('Higgsfield Cloud API 비활성 — 영상 생성 단계 중단');
    }

    await updateStep(videoJobId, 'video_generating');

    const { videoQuality } = await getPipelineModelSettings(String(job.workspace));

    const videoUrl = await generateVideo({
      imageUrl,
      prompt: job.video_prompt,
      model: job.video_model as VideoModel,
      durationSec: Number(job.duration_sec) > 0 ? Number(job.duration_sec) : 15,
      quality: videoQuality,
    });

    await updateVideoJob(videoJobId, { source_video_url: videoUrl });

    let audioUrl: string | null = null;
    let finalVideoUrl = videoUrl;
    const ttsScript = typeof job.tts_script === 'string' ? job.tts_script.trim() : '';

    if (ttsScript) {
      await updateStep(videoJobId, 'tts_generating');
      audioUrl = await generateTTS({ script: ttsScript, model: job.tts_model as TTSModel });
      await updateVideoJob(videoJobId, { tts_audio_url: audioUrl });

      await updateStep(videoJobId, 'lipsync_generating');
      finalVideoUrl = await generateLipsync({ videoUrl, audioUrl });
      await updateVideoJob(videoJobId, { source_video_url: finalVideoUrl });
    }

    // v3.26: TTS 없음 → Kling 3.0 내장 오디오 그대로 사용
    await updateStep(videoJobId, 'finalizing');

    await mkdir(tmpDir, { recursive: true });

    const outputPath = join(tmpDir, `${videoJobId}_final.mp4`);

    const sourceLocal = await downloadFile(finalVideoUrl, join(tmpDir, `${videoJobId}_source.mp4`));

    await copyFile(sourceLocal, outputPath);

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
      key: 'tiktok' | 'instagram' | 'youtube' | 'pinterest';
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
        run: async () => {
          if (job.workspace === 'quizoasis') {
            const testSlug = String(job.source_slug ?? job.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
            const urls = await uploadQuizOasisInstagramVariants({
              workspace: job.workspace,
              videoPath: outputPath,
              caption: job.caption ?? '',
              hashtags: job.hashtags ?? [],
              testSlug: testSlug || 'reel',
            });
            return urls.en ?? urls.kr;
          }
          return uploadInstagramReel({
            workspace: job.workspace,
            videoPath: outputPath,
            caption: job.caption ?? '',
            hashtags: job.hashtags ?? [],
          });
        },
      });
    }
    if (platforms.includes('pinterest') && job.workspace === 'quizoasis') {
      const testSlug = String(job.source_slug ?? 'test').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const linkUrl = `https://www.myquizoasis.com/en/test/${testSlug}`;
      const pinTitle = `${String(blogTitle).slice(0, 60)} | Find Your True Type | QuizOasis`;
      uploadTasks.push({
        key: 'pinterest',
        run: () =>
          uploadPinterestVideoPin({
            videoPath: outputPath,
            title: pinTitle,
            description: blogDescription,
            linkUrl,
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

    // Step 4 (규칙 ⑰): TikTok + Instagram + YouTube 병렬 업로드 — 실패해도 계속
    const uploadResults = await Promise.allSettled(uploadTasks.map((t) => t.run()));
    const urls: Partial<Record<'tiktok' | 'instagram' | 'youtube' | 'pinterest', string | undefined>> = {};
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

    // Step 5 (규칙 ⑰·㉘): 업로드 후 블로그 재개 — YouTube iframe 우선, TT/IG 링크 보조, YT 실패해도 중단 없음
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
