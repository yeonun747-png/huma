import { mkdir, access, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { downloadBuffer } from '../../lib/utils.js';

export const BGM_CATEGORIES = {
  upbeat: 'upbeat happy cheerful',
  calm: 'calm peaceful relaxing',
  mysterious: 'mysterious dark ambient',
  emotional: 'emotional cinematic dramatic',
  energetic: 'energetic powerful intense',
  cinematic: 'cinematic epic orchestral',
  lofi: 'lofi chill hip hop',
} as const;

export type BgmCategory = keyof typeof BGM_CATEGORIES;

export interface BgmListItem {
  id: number;
  title: string;
  duration: number;
  previewUrl: string;
  downloadUrl: string;
  tags: string[];
  likes: number;
}

export interface BgmListResponse {
  category: string;
  items: BgmListItem[];
}

const LEGACY_MOOD_MAP: Record<string, BgmCategory> = {
  calm: 'calm',
  romantic: 'emotional',
  mysterious: 'mysterious',
  energetic: 'energetic',
  inspiring: 'cinematic',
  dark: 'mysterious',
  playful: 'upbeat',
  emotional: 'emotional',
  dramatic: 'cinematic',
  upbeat: 'upbeat',
  cinematic: 'cinematic',
  lofi: 'lofi',
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const listCache = new Map<string, { expiresAt: number; data: BgmListResponse }>();

const PIXABAY_AUDIO_URL = 'https://pixabay.com/api/audio/';

interface PixabayAudioHit {
  id: number;
  name?: string;
  title?: string;
  tags: string;
  duration: number;
  likes: number;
  audio?: string | { url?: string; preview?: string };
  audioURL?: string;
  previewURL?: string;
}

interface PixabayAudioResponse {
  hits?: PixabayAudioHit[];
}

export function normalizeBgmCategory(mood: string): BgmCategory {
  const key = mood.toLowerCase().trim();
  if (key in BGM_CATEGORIES) return key as BgmCategory;
  return LEGACY_MOOD_MAP[key] ?? 'calm';
}

function getPixabayKey(): string {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error('PIXABAY_API_KEY가 설정되지 않았습니다');
  return key;
}

function parseTags(tags: string): string[] {
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function resolveAudioUrls(hit: PixabayAudioHit): { previewUrl: string; downloadUrl: string } | null {
  let downloadUrl = '';
  let previewUrl = '';

  if (typeof hit.audio === 'string') {
    downloadUrl = hit.audio;
    previewUrl = hit.audio;
  } else if (hit.audio && typeof hit.audio === 'object') {
    downloadUrl = hit.audio.url ?? '';
    previewUrl = hit.audio.preview ?? hit.audio.url ?? '';
  }

  if (!downloadUrl) downloadUrl = hit.audioURL ?? '';
  if (!previewUrl) previewUrl = hit.previewURL ?? downloadUrl;

  if (!downloadUrl) return null;

  const appendDownload = (url: string) => (url.includes('download=') ? url : `${url}${url.includes('?') ? '&' : '?'}download=1`);

  return {
    previewUrl: previewUrl || downloadUrl,
    downloadUrl: appendDownload(downloadUrl),
  };
}

function mapHit(hit: PixabayAudioHit): BgmListItem | null {
  const urls = resolveAudioUrls(hit);
  if (!urls) return null;

  const title = hit.name ?? hit.title ?? parseTags(hit.tags)[0] ?? `Track ${hit.id}`;

  return {
    id: hit.id,
    title,
    duration: hit.duration ?? 0,
    previewUrl: urls.previewUrl,
    downloadUrl: urls.downloadUrl,
    tags: parseTags(hit.tags),
    likes: hit.likes ?? 0,
  };
}

export async function fetchPixabayBgmList(categoryInput: string): Promise<BgmListResponse> {
  const category = normalizeBgmCategory(categoryInput);
  const cached = listCache.get(category);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const keyword = BGM_CATEGORIES[category];
  const params = new URLSearchParams({
    key: getPixabayKey(),
    q: keyword,
    order: 'popular',
    per_page: '20',
  });

  const res = await fetch(`${PIXABAY_AUDIO_URL}?${params.toString()}`);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(text.trim() || `Pixabay API 오류 (${res.status})`);
  }

  let parsed: PixabayAudioResponse;
  try {
    parsed = JSON.parse(text) as PixabayAudioResponse;
  } catch {
    throw new Error('Pixabay API 응답 파싱 실패');
  }

  const items = (parsed.hits ?? [])
    .map(mapHit)
    .filter((item): item is BgmListItem => item !== null);

  const data: BgmListResponse = { category, items };
  listCache.set(category, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
}

export function getBgmDownloadPath(id: number): string {
  return join(tmpdir(), 'bgm', `${id}.mp3`);
}

export function isAllowedPixabayUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === 'pixabay.com' ||
      u.hostname.endsWith('.pixabay.com') ||
      u.hostname === 'cdn.pixabay.com'
    );
  } catch {
    return false;
  }
}

export async function downloadPixabayBgm(id: number, downloadUrl: string): Promise<string> {
  if (!isAllowedPixabayUrl(downloadUrl)) {
    throw new Error('허용되지 않은 다운로드 URL');
  }

  const filePath = getBgmDownloadPath(id);

  try {
    await access(filePath);
    return filePath;
  } catch {
    // file missing — download below
  }

  await mkdir(join(tmpdir(), 'bgm'), { recursive: true });
  const buf = await downloadBuffer(downloadUrl);
  await writeFile(filePath, buf);
  return filePath;
}

export async function selectRandomBgmFile(categoryInput: string): Promise<string | null> {
  try {
    const { items } = await fetchPixabayBgmList(categoryInput);
    if (!items.length) return null;

    const pool = items.slice(0, 5);
    const selected = pool[Math.floor(Math.random() * pool.length)];
    return await downloadPixabayBgm(selected.id, selected.downloadUrl);
  } catch {
    return null;
  }
}
