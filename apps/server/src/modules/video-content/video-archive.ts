import { copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { mkdir, rename } from 'fs/promises';
import { join } from 'path';
import {
  videoContentDataDir,
  videoContentFinalPath,
  videoContentFinalThumbPath,
  videoContentSourcePath,
  videoContentSourceThumbPath,
} from './paths.js';

export interface SupersededVideoArchive {
  archivedAt: string;
  sourcePath?: string;
  subtitledPath?: string;
}

function archiveTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** 성공적인 재생성 직전 — 현재 원본·자막본을 history별 보관 폴더로 이동 */
export async function archiveCurrentVideoFiles(
  historyId: string,
): Promise<SupersededVideoArchive | null> {
  const sourcePath = videoContentSourcePath(historyId);
  const finalPath = videoContentFinalPath(historyId);
  const hasSource = existsSync(sourcePath);
  const hasFinal = existsSync(finalPath);
  if (!hasSource && !hasFinal) return null;

  const archiveDir = join(videoContentDataDir(), '_superseded', historyId);
  await mkdir(archiveDir, { recursive: true });
  const ts = archiveTimestamp();
  const archivedAt = new Date().toISOString();
  const result: SupersededVideoArchive = { archivedAt };

  if (hasSource) {
    const dest = join(archiveDir, `${ts}_source.mp4`);
    await rename(sourcePath, dest);
    result.sourcePath = dest;
    const srcThumb = videoContentSourceThumbPath(historyId);
    if (existsSync(srcThumb)) {
      await rename(srcThumb, join(archiveDir, `${ts}_source_thumb.jpg`));
    }
  }
  if (hasFinal) {
    const dest = join(archiveDir, `${ts}_subtitled.mp4`);
    await rename(finalPath, dest);
    result.subtitledPath = dest;
    const finalThumb = videoContentFinalThumbPath(historyId);
    if (existsSync(finalThumb)) {
      await rename(finalThumb, join(archiveDir, `${ts}_thumb.jpg`));
    }
  }

  return result;
}

export interface SubtitledReburnArchive {
  archivedAt: string;
  subtitledPath: string;
  thumbPath?: string;
}

/** 자막 reburn 직전 — 현재 자막본 1회분만 복사 보관 (원본·재생성 아카이브와 분리) */
export async function archiveSubtitledBeforeReburn(
  historyId: string,
): Promise<SubtitledReburnArchive | null> {
  const finalPath = videoContentFinalPath(historyId);
  if (!existsSync(finalPath)) return null;

  const archiveDir = join(videoContentDataDir(), '_superseded', historyId);
  await mkdir(archiveDir, { recursive: true });
  const ts = archiveTimestamp();
  const dest = join(archiveDir, `${ts}_subtitled_reburn.mp4`);
  await copyFile(finalPath, dest);

  let thumbPath: string | undefined;
  const finalThumb = videoContentFinalThumbPath(historyId);
  if (existsSync(finalThumb)) {
    thumbPath = join(archiveDir, `${ts}_subtitled_reburn_thumb.jpg`);
    await copyFile(finalThumb, thumbPath);
  }

  return { archivedAt: new Date().toISOString(), subtitledPath: dest, thumbPath };
}

/** reburn 직전 보관본으로 자막본 복원 */
export async function restoreSubtitledReburnArchive(
  historyId: string,
  archive: SubtitledReburnArchive,
): Promise<void> {
  if (!existsSync(archive.subtitledPath)) {
    throw new Error('이전 자막본 파일이 없습니다');
  }
  const finalPath = videoContentFinalPath(historyId);
  await mkdir(join(process.cwd(), 'data', 'video-content'), { recursive: true });
  await copyFile(archive.subtitledPath, finalPath);
  if (archive.thumbPath && existsSync(archive.thumbPath)) {
    await copyFile(archive.thumbPath, videoContentFinalThumbPath(historyId));
  }
}
