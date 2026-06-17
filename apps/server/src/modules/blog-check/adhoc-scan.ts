import { redisConnection } from '../queue/producer.js';
import type { PostExposureStatus } from './exposure-status.js';

const CACHE_TTL_SEC = 7 * 24 * 3600;

export interface AdHocBlogCheckPost {
  post_url: string;
  post_no: string | null;
  title: string;
  published_at: string;
  status: PostExposureStatus | null;
  rank: number | null;
  chars: number;
  img_count: number;
  video_count: number;
  quote_count: number;
  comment_count: number;
  like_count: number;
  gif_count: number;
  map_count: number;
  hidden_count: number;
  int_link_count: number;
  ext_link_count: number;
}

export interface AdHocBlogCheckCache {
  blogId: string;
  idxScore: number | null;
  scannedAt: string;
  posts: AdHocBlogCheckPost[];
}

const cacheKey = (blogId: string) => `blog_check:adhoc:${blogId.toLowerCase()}`;

export async function getAdHocBlogCheckCache(blogId: string): Promise<AdHocBlogCheckCache | null> {
  try {
    const raw = await redisConnection.get(cacheKey(blogId));
    if (!raw) return null;
    return JSON.parse(raw) as AdHocBlogCheckCache;
  } catch {
    return null;
  }
}

export async function setAdHocBlogCheckCache(blogId: string, cache: AdHocBlogCheckCache): Promise<void> {
  try {
    await redisConnection.set(cacheKey(blogId), JSON.stringify(cache), 'EX', CACHE_TTL_SEC);
  } catch (err) {
    console.error('[blog-check] adhoc cache set failed:', err);
  }
}
