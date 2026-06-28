import { extractFortuneSlug } from './yeonun-context.js';
import { extractQuizTestSlug } from './quizoasis-context.js';
import { extractPananaCharacterKey } from './panana-context.js';
import { pickYeonunProduct } from '../video-content/yeonun-product-picker.js';
import {
  lookupQuizContentByExternalId,
  lookupQuizContentBySlug,
  pickQuizContent,
} from '../video-content/quiz-content-cache.js';
import {
  lookupPananaCharacterByExternalId,
  lookupPananaCharacterByName,
  pickPananaCharacter,
} from '../video-content/panana-characters.js';
import { listYeonunProducts } from '../video-content/yeonun-product-picker.js';
import { logOperation } from '../../lib/log-emitter.js';
import { loadRecentPostingSubjectKeys } from '../../lib/posting-recent-subjects.js';

export const YEONUN_POSTING_URL_BASE = 'https://yeonun.com/fortune';
export const QUIZOASIS_POSTING_URL_BASE = 'https://www.myquizoasis.com/ko/test';
export const PANANA_POSTING_URL_BASE = 'https://panana.kr/c';

export interface ResolvedPostingInput {
  title: string;
  source_url: string;
  auto_picked: boolean;
  auto_pick_label?: string;
}

export function buildYeonunPostingUrl(slug: string): string {
  return `${YEONUN_POSTING_URL_BASE}/${encodeURIComponent(slug)}`;
}

export function buildQuizPostingUrl(slug: string): string {
  return `${QUIZOASIS_POSTING_URL_BASE}/${encodeURIComponent(slug)}`;
}

export function buildPananaPostingUrl(characterId: string): string {
  return `${PANANA_POSTING_URL_BASE}/${encodeURIComponent(characterId)}`;
}

export function deriveFallbackTitleFromUrl(workspace: string, sourceUrl: string): string {
  if (workspace === 'quizoasis') return extractQuizTestSlug(sourceUrl) ?? '심리테스트';
  if (workspace === 'panana') return extractPananaCharacterKey(sourceUrl) ?? '파나나 캐릭터';
  if (workspace === 'yeonun') return extractFortuneSlug(sourceUrl) ?? '연운 운세';
  return '포스팅';
}

async function inferTitleFromUrl(workspace: string, sourceUrl: string): Promise<string | null> {
  if (workspace === 'quizoasis') {
    const slug = extractQuizTestSlug(sourceUrl);
    if (!slug) return null;
    const row =
      (await lookupQuizContentBySlug(slug)) ?? (await lookupQuizContentByExternalId(slug));
    return row?.title?.trim() || null;
  }

  if (workspace === 'panana') {
    const key = extractPananaCharacterKey(sourceUrl);
    if (!key) return null;
    const row =
      (await lookupPananaCharacterByExternalId(key)) ??
      (await lookupPananaCharacterByName(key.replace(/[-_]/g, ' ')));
    return row?.name?.trim() || null;
  }

  if (workspace === 'yeonun') {
    const slug = extractFortuneSlug(sourceUrl);
    if (!slug) return null;
    const products = await listYeonunProducts();
    const product = products.find((p) => p.slug === slug);
    return product?.title?.trim() || slug;
  }

  return null;
}

async function pickPostingSubject(
  workspace: string,
  accountId?: string | null,
): Promise<{ title: string; source_url: string; label: string }> {
  const excludeRecentPostingKeys = await loadRecentPostingSubjectKeys(workspace);
  const pickOpts = { excludeRecentPostingKeys };

  if (workspace === 'yeonun') {
    const picked = await pickYeonunProduct(pickOpts);
    if (!picked) throw new Error('연운 상품 데이터 없음 — Supabase products 확인');
    return {
      title: picked.title?.trim() || picked.slug,
      source_url: buildYeonunPostingUrl(picked.slug),
      label: `연운 상품 · ${picked.slug}`,
    };
  }

  if (workspace === 'quizoasis') {
    const picked = await pickQuizContent(pickOpts);
    if (!picked) {
      throw new Error('퀴즈 캐시 없음 — 계정관리에서 퀴즈 동기화 후 재시도');
    }
    if (!picked.slug?.trim()) {
      throw new Error('퀴즈 slug 없음 — QUIZOASIS_CONTENT_API 동기화 데이터 확인');
    }
    return {
      title: picked.title.trim(),
      source_url: buildQuizPostingUrl(picked.slug),
      label: `퀴즈 · ${picked.slug}`,
    };
  }

  if (workspace === 'panana') {
    const picked = await pickPananaCharacter(accountId ?? '', pickOpts);
    if (!picked) {
      throw new Error('파나나 캐릭터 캐시 없음 — 계정관리에서 동기화 후 재시도');
    }
    return {
      title: picked.name.trim(),
      source_url: buildPananaPostingUrl(picked.panana_character_id),
      label: `캐릭터 · ${picked.name}`,
    };
  }

  throw new Error(`지원하지 않는 워크스페이스: ${workspace}`);
}

/** 제목·URL 비어 있으면 워크스페이스 캐시에서 자동 선택 */
export async function resolveAutoPostingInput(params: {
  workspace: string;
  accountId?: string | null;
  title?: string;
  source_url?: string;
}): Promise<ResolvedPostingInput> {
  const title = params.title?.trim() ?? '';
  const source_url = params.source_url?.trim() ?? '';

  if (title && source_url) {
    return { title, source_url, auto_picked: false };
  }

  if (source_url && !title) {
    const inferred = await inferTitleFromUrl(params.workspace, source_url);
    const resolved: ResolvedPostingInput = {
      title: inferred ?? deriveFallbackTitleFromUrl(params.workspace, source_url),
      source_url,
      auto_picked: Boolean(inferred),
      auto_pick_label: inferred ? 'URL 캐시에서 제목 추론' : undefined,
    };
    if (resolved.auto_picked) {
      await logOperation({
        level: 'info',
        message: `[auto-posting] ${resolved.auto_pick_label}: ${resolved.title}`,
        workspace: params.workspace,
      });
    }
    return resolved;
  }

  if (title && !source_url) {
    const picked = await pickPostingSubject(params.workspace, params.accountId);
    const resolved: ResolvedPostingInput = {
      title,
      source_url: picked.source_url,
      auto_picked: true,
      auto_pick_label: `${picked.label} (URL 자동)`,
    };
    await logOperation({
      level: 'info',
      message: `[auto-posting] ${resolved.auto_pick_label}`,
      workspace: params.workspace,
    });
    return resolved;
  }

  const picked = await pickPostingSubject(params.workspace, params.accountId);
  const resolved: ResolvedPostingInput = {
    title: picked.title,
    source_url: picked.source_url,
    auto_picked: true,
    auto_pick_label: picked.label,
  };
  await logOperation({
    level: 'info',
    message: `[auto-posting] 완전 자동 — ${resolved.auto_pick_label} → ${resolved.source_url}`,
    workspace: params.workspace,
  });
  return resolved;
}
