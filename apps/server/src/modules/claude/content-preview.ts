import { generateAllContent, type ContentGenerationInput } from './content-generator.js';
import { generateImage } from '../higgsfield/image.js';
import { selectImageModel } from '../claude/auto-decide.js';
import { supabase } from '../../middleware/auth.js';
import { resolveBlogWritingPersona } from '../../lib/blog-writing-persona.js';
import { pickPostingAccount } from '../../lib/posting-accounts.js';

export type PreviewStepStatus = 'pending' | 'running' | 'ok' | 'err';

export interface PreviewStep {
  id: string;
  label: string;
  status: PreviewStepStatus;
  detail?: string;
  ms?: number;
}

export interface ContentPreviewInput {
  workspace: string;
  title: string;
  source_url: string;
  synopsis?: string;
  uploaded_images?: string[];
  content_type?: 'A' | 'B';
  account_id?: string;
}

export interface ContentPreviewResult {
  steps: PreviewStep[];
  generated?: Awaited<ReturnType<typeof generateAllContent>>;
  image_url?: string;
  image_model?: string;
  dry_run: true;
  total_ms: number;
}

async function loadAccountBlogPersona(workspace: string, accountId?: string) {
  if (accountId) {
    const { data } = await supabase
      .from('huma_accounts')
      .select('id, persona')
      .eq('id', accountId)
      .eq('workspace', workspace)
      .eq('account_type', 'posting')
      .eq('is_active', true)
      .maybeSingle();
    return {
      accountId: data?.id as string | undefined,
      blogWritingPersona: resolveBlogWritingPersona(
        workspace,
        data?.persona as Record<string, unknown> | null,
      ),
    };
  }

  const picked = await pickPostingAccount(workspace, { advance: false });
  return {
    accountId: picked?.id,
    blogWritingPersona: resolveBlogWritingPersona(workspace, picked?.persona ?? null),
  };
}

export async function runContentPreview(input: ContentPreviewInput): Promise<ContentPreviewResult> {
  const started = Date.now();
  const steps: PreviewStep[] = [
    { id: 'claude', label: 'Claude — 블로그 글·해시태그 작성', status: 'pending' },
    { id: 'imagen', label: 'Imagen — 대표 이미지 생성', status: 'pending' },
  ];

  const { blogWritingPersona } = await loadAccountBlogPersona(input.workspace, input.account_id);

  const genInput: ContentGenerationInput = {
    title: input.title.trim(),
    sourceUrl: input.source_url.trim(),
    synopsis: input.synopsis?.trim(),
    workspace: input.workspace,
    content_type: input.content_type ?? 'A',
    blogWritingPersona,
  };

  const uploaded = (input.uploaded_images ?? []).filter((u) => Boolean(u?.trim()));
  const hasUploaded = uploaded.length > 0;

  let generated: Awaited<ReturnType<typeof generateAllContent>> | undefined;
  const claudeStart = Date.now();
  steps[0]!.status = 'running';
  try {
    generated = await generateAllContent(genInput);
    steps[0] = {
      ...steps[0]!,
      status: 'ok',
      ms: Date.now() - claudeStart,
      detail: `본문 ${generated.blog_post.length}자 (목표 ${generated.blog_post_target_min_chars ?? '?'}~${generated.blog_post_target_max_chars ?? generated.blog_post_target_chars ?? '?'}자) · SEO제목 ${generated.seo_title} · image_prompt ${generated.image_prompt.slice(0, 80)}…`,
    };
  } catch (err) {
    steps[0] = {
      ...steps[0]!,
      status: 'err',
      ms: Date.now() - claudeStart,
      detail: (err as Error).message,
    };
    return { steps, dry_run: true, total_ms: Date.now() - started };
  }

  if (hasUploaded) {
    steps[1] = {
      ...steps[1]!,
      status: 'ok',
      ms: 0,
      detail: `등록 이미지 ${uploaded.length}장 (Imagen 생략)`,
    };
    return {
      steps,
      generated,
      image_url: uploaded[0],
      dry_run: true,
      total_ms: Date.now() - started,
    };
  }

  const imagenStart = Date.now();
  steps[1]!.status = 'running';
  const imageModel = selectImageModel(input.workspace);
  try {
    const imageUrl = await generateImage({
      prompt: generated.image_prompt,
      model: imageModel,
    });
    steps[1] = {
      ...steps[1]!,
      status: 'ok',
      ms: Date.now() - imagenStart,
      detail: imageUrl,
    };
    return {
      steps,
      generated,
      image_url: imageUrl,
      image_model: imageModel,
      dry_run: true,
      total_ms: Date.now() - started,
    };
  } catch (err) {
    steps[1] = {
      ...steps[1]!,
      status: 'err',
      ms: Date.now() - imagenStart,
      detail: (err as Error).message,
    };
    return { steps, generated, dry_run: true, total_ms: Date.now() - started };
  }
}

export async function patchJobPreviewProgress(
  jobId: string,
  steps: PreviewStep[],
  extra?: Record<string, unknown>,
) {
  const { data: job } = await supabase.from('huma_jobs').select('platform_schedule').eq('id', jobId).maybeSingle();
  const prev = (job?.platform_schedule as Record<string, unknown> | null) ?? {};
  await supabase
    .from('huma_jobs')
    .update({
      platform_schedule: {
        ...prev,
        _dry_run: true,
        _preview: { steps, ...extra, updated_at: new Date().toISOString() },
      },
    })
    .eq('id', jobId);
}

/** content_full 실행 중 — dry_run 플래그 없이 발행 모니터·큐 단계만 갱신 */
export async function patchJobGenerationProgress(
  jobId: string,
  steps: PreviewStep[],
  extra?: Record<string, unknown>,
) {
  const { data: job } = await supabase.from('huma_jobs').select('platform_schedule').eq('id', jobId).maybeSingle();
  const prev = (job?.platform_schedule as Record<string, unknown> | null) ?? {};
  await supabase
    .from('huma_jobs')
    .update({
      platform_schedule: {
        ...prev,
        _preview: { steps, ...extra, updated_at: new Date().toISOString() },
      },
    })
    .eq('id', jobId);
}
