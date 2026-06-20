import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import {
  videoContentFinalPath,
  videoContentFinalThumbPath,
  videoContentSourcePath,
  videoContentSourceThumbPath,
} from './paths.js';

function thumbPathForVariant(historyId: string, variant: 'subtitled' | 'source'): string {
  return variant === 'source'
    ? videoContentSourceThumbPath(historyId)
    : videoContentFinalThumbPath(historyId);
}

function videoPathForVariant(
  historyId: string,
  variant: 'subtitled' | 'source',
  storedPath?: string | null,
): string {
  if (variant === 'source') {
    return storedPath || videoContentSourcePath(historyId);
  }
  return storedPath || videoContentFinalPath(historyId);
}

export function storageFileName(historyId: string, variant: 'subtitled' | 'source'): string {
  const short = historyId.slice(0, 8);
  return variant === 'source' ? `${short}-source.mp4` : `${short}-subtitled.mp4`;
}

export async function generateVideoThumbnail(videoPath: string, thumbPath: string): Promise<void> {
  if (!existsSync(videoPath)) return;
  const cmd = [
    'ffmpeg -y',
    '-ss 1',
    `-i "${videoPath}"`,
    '-vframes 1',
    '-q:v 3',
    '-vf "scale=360:-2"',
    `"${thumbPath}"`,
  ].join(' ');
  execSync(cmd, { stdio: 'pipe' });
}

export async function ensureVideoThumbnail(params: {
  historyId: string;
  variant: 'subtitled' | 'source';
  videoPath?: string | null;
}): Promise<string | null> {
  const videoPath = videoPathForVariant(params.historyId, params.variant, params.videoPath);
  const thumbPath = thumbPathForVariant(params.historyId, params.variant);
  if (!existsSync(videoPath)) return null;
  if (existsSync(thumbPath)) return thumbPath;
  try {
    await generateVideoThumbnail(videoPath, thumbPath);
    return existsSync(thumbPath) ? thumbPath : null;
  } catch {
    return null;
  }
}

export async function generateVideoContentThumbnails(params: {
  historyId: string;
  subtitledPath?: string | null;
  sourcePath?: string | null;
}): Promise<void> {
  const { historyId } = params;
  if (params.sourcePath || existsSync(videoContentSourcePath(historyId))) {
    await ensureVideoThumbnail({
      historyId,
      variant: 'source',
      videoPath: params.sourcePath,
    }).catch(() => {});
  }
  if (params.subtitledPath || existsSync(videoContentFinalPath(historyId))) {
    await ensureVideoThumbnail({
      historyId,
      variant: 'subtitled',
      videoPath: params.subtitledPath,
    }).catch(() => {});
  }
}

export async function removeVideoContentThumb(
  historyId: string,
  variant: 'subtitled' | 'source',
): Promise<void> {
  const path = thumbPathForVariant(historyId, variant);
  if (existsSync(path)) await unlink(path).catch(() => {});
}

export function resolveVideoContentThumbPath(
  historyId: string,
  variant: 'subtitled' | 'source',
): string {
  return thumbPathForVariant(historyId, variant);
}
