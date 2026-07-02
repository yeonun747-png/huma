import { supabase } from '../middleware/auth.js';
import {
  DEFAULT_NIGHT_BAN_END,
  DEFAULT_NIGHT_BAN_START,
  isKstNightBan,
} from './crank-schedule-config.js';

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
  /** 본문 단락 중 Ctrl+V 비율 (0~1). 기본 0.55 */
  paste_ratio?: number;
  /**
   * OS IME(fcitx-hangul) 사용 여부. 기본 false.
   * Playwright의 CDP 키 주입은 OS IME 레이어를 거치지 않아 fcitx가 한글을 조합하지 못한다
   * (raw 알파벳 입력 위험). 합성 composition(korean-ime.ts)이 fcitx 비의존으로 한글을 정확히 입력하므로 기본값.
   * 운영자가 fcitx 환경을 검증했다면 true로 설정 — 이때 브라우저 env에 fcitx 모듈이 함께 주입된다.
   */
  use_os_ime?: boolean;
}

export function resolvePasteRatio(config: HumanEngineConfig): number {
  const r = config.paste_ratio;
  if (typeof r === 'number' && r >= 0 && r <= 1) return r;
  return 0.55;
}

export async function getHumanEngineConfig(): Promise<HumanEngineConfig> {
  return getSetting('human_engine', {
    wpm_mean: 55,
    wpm_sigma: 18,
    typo_rate: 0.04,
    backspace_delay_ms: [200, 800],
    paragraph_pause_ms: [5000, 20000],
    review_duration_ms: [120000, 300000],
    night_ban_start: DEFAULT_NIGHT_BAN_START,
    night_ban_end: DEFAULT_NIGHT_BAN_END,
    paste_ratio: 0.55,
    // 합성 composition 입력이 기본(fcitx/CDP 비의존, 한글 정확). OS IME는 명시 활성 시에만.
    use_os_ime: false,
  });
}

/** @deprecated worker는 isNightBanActive() 사용 (KST + app_settings) */
export function isNightBan(config?: HumanEngineConfig): boolean {
  const c = config ?? { night_ban_start: DEFAULT_NIGHT_BAN_START, night_ban_end: DEFAULT_NIGHT_BAN_END };
  return isKstNightBan(c.night_ban_start, c.night_ban_end);
}
