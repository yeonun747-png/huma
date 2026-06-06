import type { HumaJob } from '@huma/shared';

type PreviewMeta = {
  steps?: Array<{ id: string; status: string; detail?: string }>;
  image_url?: string;
};

function isHttpImageUrl(url: unknown): url is string {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

/** 검증 미리보기용 Imagen URL — image_urls · _preview.image_url · imagen step detail */
export function resolvePreviewImageUrl(job: HumaJob | null | undefined): string | null {
  if (!job) return null;

  if (isHttpImageUrl(job.image_urls?.[0])) return job.image_urls[0];

  const ps = job.platform_schedule as Record<string, unknown> | undefined;
  const preview = ps?._preview as PreviewMeta | undefined;

  if (isHttpImageUrl(preview?.image_url)) return preview.image_url;

  const imagenDetail = preview?.steps?.find((s) => s.id === 'imagen')?.detail;
  if (isHttpImageUrl(imagenDetail)) return imagenDetail;

  return null;
}

export function isPreviewImagenDone(job: HumaJob | null | undefined): boolean {
  if (!job) return false;
  const ps = job.platform_schedule as Record<string, unknown> | undefined;
  const preview = ps?._preview as PreviewMeta | undefined;
  const step = preview?.steps?.find((s) => s.id === 'imagen');
  if (step?.status === 'ok' || step?.status === 'err') return true;
  // 구버전 job: completed + http 이미지면 완료로 간주
  return job.status === 'completed' && Boolean(resolvePreviewImageUrl(job));
}

export function getPreviewImagenError(job: HumaJob | null | undefined): string | null {
  const ps = job?.platform_schedule as Record<string, unknown> | undefined;
  const preview = ps?._preview as PreviewMeta | undefined;
  const step = preview?.steps?.find((s) => s.id === 'imagen');
  if (step?.status === 'err' && step.detail) return step.detail;
  if (job?.status === 'failed' && job.error_message?.toLowerCase().includes('imagen')) {
    return job.error_message;
  }
  return null;
}
