import { existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data', 'video-content');

export function videoContentFinalPath(historyId: string): string {
  return join(DATA_DIR, `${historyId}.mp4`);
}

export function videoContentSourcePath(historyId: string): string {
  return join(DATA_DIR, `${historyId}_source.mp4`);
}

export function resolveStoredVideoPath(
  historyId: string,
  storedPath: string | null | undefined,
  kind: 'final' | 'source',
): string {
  if (storedPath && existsSync(storedPath)) return storedPath;
  return kind === 'final' ? videoContentFinalPath(historyId) : videoContentSourcePath(historyId);
}

export function videoContentFinalThumbPath(historyId: string): string {
  return join(DATA_DIR, `${historyId}_thumb.jpg`);
}

export function videoContentSourceThumbPath(historyId: string): string {
  return join(DATA_DIR, `${historyId}_source_thumb.jpg`);
}

export function videoContentDataDir(): string {
  return DATA_DIR;
}
