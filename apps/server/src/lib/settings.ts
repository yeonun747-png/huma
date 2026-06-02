import { supabase } from '../middleware/auth.js';
import { isKstNightBan } from './crank-schedule-config.js';

const cache = new Map<string, unknown>();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const { data } = await supabase.from('huma_settings').select('value').eq('key', key).single();
  const val = (data?.value as T) ?? fallback;
  cache.set(key, val);
  return val;
}

export async function updateSetting(key: string, value: unknown) {
  cache.set(key, value);
  await supabase
    .from('huma_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
}

export function clearSettingsCache() {
  cache.clear();
}

export interface FingerprintRuntimeConfig {
  canvas_spoof: boolean;
  webgl_spoof: boolean;
  audio_noise: boolean;
}

export async function getFingerprintConfig(): Promise<FingerprintRuntimeConfig> {
  const engine = await getSetting<{ fingerprint?: Partial<FingerprintRuntimeConfig> }>('human_engine', {});
  const fp = engine.fingerprint ?? {};
  return {
    canvas_spoof: fp.canvas_spoof !== false,
    webgl_spoof: fp.webgl_spoof !== false,
    audio_noise: fp.audio_noise !== false,
  };
}

export interface HumanEngineConfig {
  wpm_mean: number;
  wpm_sigma: number;
  typo_rate: number;
  backspace_delay_ms: [number, number];
  paragraph_pause_ms: [number, number];
  review_duration_ms: [number, number];
  night_ban_start: number;
  night_ban_end: number;
}

export async function getHumanEngineConfig(): Promise<HumanEngineConfig> {
  return getSetting('human_engine', {
    wpm_mean: 55,
    wpm_sigma: 18,
    typo_rate: 0.04,
    backspace_delay_ms: [200, 800],
    paragraph_pause_ms: [2000, 8000],
    review_duration_ms: [120000, 300000],
    night_ban_start: 1,
    night_ban_end: 7,
  });
}

/** @deprecated worker는 isNightBanActive() 사용 (KST + app_settings) */
export function isNightBan(config?: HumanEngineConfig): boolean {
  const c = config ?? { night_ban_start: 1, night_ban_end: 7 };
  return isKstNightBan(c.night_ban_start, c.night_ban_end);
}
