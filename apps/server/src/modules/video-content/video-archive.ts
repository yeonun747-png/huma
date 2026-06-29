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
