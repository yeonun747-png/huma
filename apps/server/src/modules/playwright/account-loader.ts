import { mkdirSync } from 'fs';
import { join } from 'path';
import { supabase } from '../../middleware/auth.js';
import { generateFingerprint, type AccountFingerprint } from './fingerprint.js';
import { parsePersona, type AccountPersona } from './persona.js';
import type { BrowserAccountContext } from './browser.js';

const PROFILES_ROOT = process.env.HUMA_PROFILES_DIR ?? '/data/browser-profiles';

export function getProfilePath(accountId: string, stored?: string | null): string {
  if (stored) return stored;
  return join(PROFILES_ROOT, accountId);
}

export function hasStoredSession(profilePath: string): boolean {
  return Boolean(profilePath);
}

export async function ensureAccountAntiDetect(accountId: string, workspace: string): Promise<void> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('fingerprint, persona, profile_path')
    .eq('id', accountId)
    .single();

  if (!account) return;

  const updates: Record<string, unknown> = {};
  if (!account.fingerprint) {
    updates.fingerprint = generateFingerprint(accountId);
  }
  // 규칙 ⑲: fingerprint 컬럼이 있으면 절대 덮어쓰지 않음
  if (!account.persona) {
    const { generatePersona } = await import('./persona.js');
    updates.persona = await generatePersona(workspace);
  }
  const profilePath = getProfilePath(accountId, account.profile_path);
  if (!account.profile_path) {
    updates.profile_path = profilePath;
  }
  mkdirSync(profilePath, { recursive: true });

  if (Object.keys(updates).length) {
    await supabase.from('huma_accounts').update(updates).eq('id', accountId);
  }
}

export async function loadAccountForBrowser(
  accountId: string,
  proxyPort?: number,
): Promise<BrowserAccountContext> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('id, proxy_port, fingerprint, persona, profile_path, account_type, warmup_day, health_score, workspace, layer4_rest_until, is_active')
    .eq('id', accountId)
    .single();

  if (!account) throw new Error('계정 없음');

  if (account.layer4_rest_until && new Date(account.layer4_rest_until) > new Date()) {
    throw new Error('LAYER4_REST');
  }
  if (account.is_active === false) {
    throw new Error('ACCOUNT_INACTIVE');
  }

  let fingerprint = account.fingerprint as AccountFingerprint | null;
  if (!fingerprint) {
    fingerprint = generateFingerprint(accountId);
    await supabase.from('huma_accounts').update({ fingerprint }).eq('id', accountId);
  } else if (typeof fingerprint !== 'object' || !fingerprint.userAgent) {
    throw new Error('FINGERPRINT_CORRUPT');
  }
  // 규칙 ⑲: 저장된 fingerprint 재생성·overwrite 금지

  let persona = parsePersona(account.persona);
  if (!account.persona) {
    const { generatePersona } = await import('./persona.js');
    persona = await generatePersona(account.workspace ?? 'yeonun');
    await supabase.from('huma_accounts').update({ persona }).eq('id', accountId);
  }

  const profile_path = getProfilePath(accountId, account.profile_path);
  mkdirSync(profile_path, { recursive: true });
  if (!account.profile_path) {
    await supabase.from('huma_accounts').update({ profile_path }).eq('id', accountId);
  }

  return {
    id: accountId,
    proxy_port: proxyPort ?? account.proxy_port ?? undefined,
    fingerprint,
    persona,
    profile_path,
    account_type: account.account_type,
    warmup_day: account.warmup_day ?? 0,
    health_score: account.health_score ?? 100,
  };
}

export async function maybeIncrementWarmupDay(accountId: string): Promise<void> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('warmup_day, warmup_last_increment_date')
    .eq('id', accountId)
    .single();

  if (!account) return;
  if (account.warmup_last_increment_date === today) return;
  if ((account.warmup_day ?? 0) >= 30) return;

  await supabase
    .from('huma_accounts')
    .update({
      warmup_day: (account.warmup_day ?? 0) + 1,
      warmup_last_increment_date: today,
    })
    .eq('id', accountId);
}
