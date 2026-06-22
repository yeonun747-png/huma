import {
  formatPananaContext,
  lookupPananaCharacterByExternalId,
  lookupPananaCharacterByName,
  type PananaCharacterRow,
} from '../video-content/panana-characters.js';

const PANANA_CHARACTER_PATH_RE = /\/(?:character|characters|c|chat)\/([^/?#]+)/i;
const PANANA_HOST_RE = /panana\.(?:kr|com)/i;
const GENERIC_PATH_SEGMENTS = new Set(['about', 'login', 'signup', 'api', 'home', 'explore', 'search']);

export function extractPananaCharacterKey(sourceUrl: string): string | null {
  const pathMatch = sourceUrl.match(PANANA_CHARACTER_PATH_RE);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim() || null;

  try {
    const u = new URL(sourceUrl.startsWith('http') ? sourceUrl : `https://${sourceUrl}`);
    if (!PANANA_HOST_RE.test(u.hostname)) return null;

    for (const key of ['characterId', 'character_id', 'id']) {
      const v = u.searchParams.get(key)?.trim();
      if (v) return v;
    }

    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && !GENERIC_PATH_SEGMENTS.has(last.toLowerCase()) && last.length >= 3) {
      return decodeURIComponent(last);
    }
  } catch {
    return null;
  }

  return null;
}

async function resolvePananaFromUrl(sourceUrl: string): Promise<PananaCharacterRow | null> {
  const key = extractPananaCharacterKey(sourceUrl);
  if (!key) return null;

  const byId = await lookupPananaCharacterByExternalId(key);
  if (byId) return byId;

  return lookupPananaCharacterByName(key.replace(/[-_]/g, ' '));
}

export type WorkspaceSourceContext = {
  text: string;
  cacheHit: boolean;
};

/** 관련 URL → 파나나 캐릭터 캐시 컨텍스트 (포스팅 Claude용) */
export async function buildPananaContextWithPrompt(sourceUrl: string): Promise<WorkspaceSourceContext> {
  const row = await resolvePananaFromUrl(sourceUrl);
  if (!row) return { text: '', cacheHit: false };
  return { text: formatPananaContext(row, 'posting'), cacheHit: true };
}
