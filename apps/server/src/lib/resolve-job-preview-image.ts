type PreviewMeta = {
  steps?: Array<{ id: string; status: string; detail?: string }>;
  image_url?: string;
};

function isHttpImageUrl(url: unknown): url is string {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

export function resolveJobPreviewImageUrl(job: {
  image_urls?: string[] | null;
  platform_schedule?: Record<string, unknown> | null;
}): string | null {
  if (isHttpImageUrl(job.image_urls?.[0])) return job.image_urls[0];

  const preview = job.platform_schedule?._preview as PreviewMeta | undefined;
  if (isHttpImageUrl(preview?.image_url)) return preview.image_url;

  const imagenDetail = preview?.steps?.find((s) => s.id === 'imagen')?.detail;
  if (isHttpImageUrl(imagenDetail)) return imagenDetail;

  return null;
}
