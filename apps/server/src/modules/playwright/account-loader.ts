import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { supabase } from '../../middleware/auth.js';
import { generateFingerprint, type AccountFingerprint } from './fingerprint.js';
import { parsePersona, type AccountPersona } from './persona.js';
import type { BrowserAccountContext } from './browser.js';

const PROFILES_ROOT = process.env.HUMA_PROFILES_DIR ?? join(process.cwd(), 'profiles');

export function getProfilePath(accountId: string, stored?: string | null): string {
  return stored ?? join(PROFILES_ROOT, accountId);
}

export function hasStoredSession(profilePath: string): boolean {
  return existsSync(join(profilePath, 'state.json'));
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
  proxyPort?: number
): Promise<BrowserAccountContext> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('id, proxy_port, fingerprint, persona, profile_path, account_type, warmup_day, health_score, workspace')
    .eq('id', accountId)
    .single();

  if (!account) throw new Error('계정 없음');

  let fingerprint = account.fingerprint as AccountFingerprint | null;
  if (!fingerprint) {
    fingerprint = generateFingerprint(accountId);
    await supabase.from('huma_accounts').update({ fingerprint }).eq('id', accountId);
  }

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
