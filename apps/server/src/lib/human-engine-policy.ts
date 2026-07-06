import { supabase } from '../middleware/auth.js';
import { DEFAULT_NIGHT_BAN_END, DEFAULT_NIGHT_BAN_START, formatNightBanRangeLabel, getKstClock, isKstNightBan } from './crank-schedule-config.js';
import { PLATFORM_DAILY_LIMITS } from './limits.js';
import { getDailyPostingTarget } from './posting-daily-target.js';
import {
  computeDynamicPublishIntervalHours,
  deriveActiveHourWindow,
  getActivePostingWindowHours,
} from './posting-interval.js';
import { ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS } from './posting-warmup.js';
import { getHumanEngineConfig, getSetting, type HumanEngineConfig } from './settings.js';

export interface AppSettings {
  claude_api?: boolean;
  /** v3.26 — Haiku: Imagen 모델 판단·해시태그·autoDecide */
  claude_haiku_api?: boolean;
  /** v3.26 — Google Imagen 4 (이미지 전용) */
  google_imagen_api?: boolean;
  /** v3.26 — Higgsfield Cloud (영상·Kling 3.0 전용) */
  higgsfield_api?: boolean;
  slack_webhook?: boolean;
  daily_limit?: boolean;
  night_ban?: boolean;
  /** post_blog 로그인 전 네이버 검색 워밍업 확률(%) — 합계 100 */
  posting_warmup?: PostingWarmupSettings;
}

/** post_blog 세션 워밍업 — skip=0회, light=1~2회, full=2~3회 */
export interface PostingWarmupSettings {
  skip_pct: number;
  light_pct: number;
  full_pct: number;
}

export const DEFAULT_POSTING_WARMUP: PostingWarmupSettings = {
  skip_pct: 80,
  light_pct: 15,
  full_pct: 5,
};

export interface WatcherSettings {
  slack_webhook?: string;
  /** Layer4 CAPTCHA·429 감지 시 Slack 알림 ON/OFF */
  captcha_slack?: boolean;
  cooldown_429_min?: number;
  /** 429 감지 후 자동 쿨다운 대기 ON/OFF */
  cooldown_auto?: boolean;
  recovery_steps_min?: number[];
  auto_pause?: boolean;
  gradual_recovery?: boolean;
}

export interface HumanEngineScheduleConfig extends HumanEngineConfig {
  active_hours?: number[];
  weekend_ratio?: number;
  min_publish_interval_hours?: number;
  fingerprint?: {
    captcha_slack?: boolean;
    captcha_telegram?: boolean;
    /** Claude Vision 자동 CAPTCHA 해결 (3회 실패 시 VNC) */
    captcha_vision_auto?: boolean;
    cooldown_429_hours?: number;
    canvas_spoof?: boolean;
    webgl_spoof?: boolean;
    audio_noise?: boolean;
    mouse_bezier?: boolean;
    click_jitter_px?: number;
    auto_pause_on_detect?: boolean;
  };
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  claude_api: true,
  claude_haiku_api: true,
  google_imagen_api: true,
  higgsfield_api: true,
  daily_limit: true,
  night_ban: true,
  slack_webhook: true,
  posting_warmup: { ...DEFAULT_POSTING_WARMUP },
};

function clampWarmupPct(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function normalizePostingWarmupSettings(
  raw?: Partial<PostingWarmupSettings> | null,
): PostingWarmupSettings {
  return {
    skip_pct: clampWarmupPct(raw?.skip_pct, DEFAULT_POSTING_WARMUP.skip_pct),
    light_pct: clampWarmupPct(raw?.light_pct, DEFAULT_POSTING_WARMUP.light_pct),
    full_pct: clampWarmupPct(raw?.full_pct, DEFAULT_POSTING_WARMUP.full_pct),
  };
}

/** post_blog preSessionWarmup — app_settings.posting_warmup 확률 */
export async function getPostingWarmupSettings(): Promise<PostingWarmupSettings> {
  const app = await getAppSettings();
  return normalizePostingWarmupSettings(app.posting_warmup);
}

const DEFAULT_WATCHER: WatcherSettings = {
  captcha_slack: true,
  cooldown_auto: true,
  cooldown_429_min: 15,
  recovery_steps_min: [12, 30, 120],
  auto_pause: true,
  gradual_recovery: true,
};

const POSTING_JOB_TYPES = ['post_blog', 'cafe_new_post'];

export async function getAppSettings(): Promise<AppSettings> {
  const raw = await getSetting<AppSettings>('app_settings', {});
  const legacyMedia = raw.higgsfield_api ?? true;
  return {
    ...DEFAULT_APP_SETTINGS,
    ...raw,
    claude_haiku_api: raw.claude_haiku_api ?? raw.claude_api ?? true,
    google_imagen_api: raw.google_imagen_api ?? legacyMedia,
    higgsfield_api: raw.higgsfield_api ?? legacyMedia,
    posting_warmup: normalizePostingWarmupSettings(raw.posting_warmup ?? DEFAULT_APP_SETTINGS.posting_warmup),
  };
}

export async function isGoogleImagenEnabled(): Promise<boolean> {
  const app = await getAppSettings();
  if (app.google_imagen_api === false) return false;
  return Boolean(process.env.GOOGLE_AI_API_KEY?.trim());
}

export async function isHiggsfieldVideoEnabled(): Promise<boolean> {
  const app = await getAppSettings();
  if (app.higgsfield_api === false) return false;
  return Boolean(process.env.HIGGSFIELD_API_KEY?.trim());
}

export async function isHaikuSubEnabled(): Promise<boolean> {
  const app = await getAppSettings();
  if (app.claude_haiku_api === false) return false;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function getWatcherSettings(): Promise<WatcherSettings> {
  return { ...DEFAULT_WATCHER, ...(await getSetting<WatcherSettings>('watcher', {})) };
}

export async function getHumanEngineScheduleConfig(): Promise<HumanEngineScheduleConfig> {
  return getSetting<HumanEngineScheduleConfig>('human_engine', await getHumanEngineConfig());
}

export function isKstNightBanFromConfig(
  human: Pick<HumanEngineConfig, 'night_ban_start' | 'night_ban_end'>,
): boolean {
  return isKstNightBan(human.night_ban_start ?? DEFAULT_NIGHT_BAN_START, human.night_ban_end ?? DEFAULT_NIGHT_BAN_END);
}

/** app_settings.night_ban + human_engine 야간 구간 (KST) */
export async function isNightBanActive(): Promise<boolean> {
  const app = await getAppSettings();
  if (app.night_ban === false) return false;
  return isKstNightBanFromConfig(await getHumanEngineConfig());
}

export async function getNightBanBlockMessage(): Promise<string> {
  const human = await getHumanEngineConfig();
  const range = formatNightBanRangeLabel(
    human.night_ban_start ?? DEFAULT_NIGHT_BAN_START,
    human.night_ban_end ?? DEFAULT_NIGHT_BAN_END,
  );
  return `야간 발행 금지 시간대 (${range} KST)`;
}

/** 활성 시간대 히트맵 — intensity 0이면 차단, 그 외 확률 통과 */
export async function passesActiveHoursGate(): Promise<boolean> {
  const human = await getHumanEngineScheduleConfig();
  const hours = human.active_hours;
  if (!hours?.length || hours.length !== 24) return true;

  const { hour } = getKstClock();
  const intensity = hours[hour] ?? 0;
  if (intensity <= 0) return false;
  if (intensity >= 1) return true;
  return Math.random() <= intensity;
}

export function msUntilNextActiveHour(activeHours: number[]): number {
  const { hour } = getKstClock();
  for (let offset = 1; offset <= 24; offset++) {
    const h = (hour + offset) % 24;
    if ((activeHours[h] ?? 0) > 0) {
      return offset * 60 * 60 * 1000;
    }
  }
  return 60 * 60 * 1000;
}

export function isKstWeekend(now = new Date()): boolean {
  const dow = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
  }).format(now);
  return dow === 'Sat' || dow === 'Sun';
}

/** 주말 발행량 = 평일 × weekend_ratio */
export async function passesWeekendVolumeGate(): Promise<boolean> {
  if (!isKstWeekend()) return true;
  const human = await getHumanEngineScheduleConfig();
  const ratio = human.weekend_ratio ?? 0.5;
  return Math.random() <= ratio;
}

export async function getEffectiveDailyLimit(jobType: string): Promise<number> {
  const app = await getAppSettings();
  if (app.daily_limit === false) return 999_999;
  return PLATFORM_DAILY_LIMITS[jobType] ?? 10;
}

export async function checkMinPublishInterval(accountId: string, jobType: string): Promise<number | null> {
  if (!POSTING_JOB_TYPES.includes(jobType)) return null;

  const human = await getHumanEngineScheduleConfig();
  const floorHours = ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS;

  const { data: acc } = await supabase
    .from('huma_accounts')
    .select('warmup_day')
    .eq('id', accountId)
    .maybeSingle();
  const warmupDay = (acc?.warmup_day as number | undefined) ?? 0;
  const targetInfo = getDailyPostingTarget(accountId, new Date(), { warmupDay });
  const windowHours = getActivePostingWindowHours(human.active_hours ?? []);
  const minHours = computeDynamicPublishIntervalHours(targetInfo.target, windowHours, floorHours);

  const { data } = await supabase
    .from('huma_jobs')
    .select('completed_at')
    .eq('account_id', accountId)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.completed_at) return null;

  const waitMs = minHours * 3600_000 - (Date.now() - new Date(data.completed_at).getTime());
  return waitMs > 0 ? waitMs : null;
}

export { deriveActiveHourWindow } from './posting-interval.js';

export async function getCrankScheduleWindow(): Promise<{ start: number; end: number }> {
  return { start: 4, end: 24 };
}

export function resolve429CooldownMs(watcher: WatcherSettings): number {
  if (watcher.cooldown_auto === false) return 0;
  return (watcher.cooldown_429_min ?? 15) * 60_000;
}

export function resolveRecoveryDelayMs(
  tier: number,
  is429: boolean,
  watcher: WatcherSettings,
): number {
  if (watcher.gradual_recovery === false) {
    return resolve429CooldownMs(watcher);
  }

  const steps = watcher.recovery_steps_min ?? [12, 30, 120];
  if (tier >= 3) return (steps[2] ?? 120) * 60_000;
  if (is429 || tier >= 2) return resolve429CooldownMs(watcher);
  return (steps[0] ?? 12) * 60_000;
}

export async function shouldNotifySlack(): Promise<boolean> {
  const app = await getAppSettings();
  if (app.slack_webhook === false) return false;

  const watcher = await getWatcherSettings();
  if (watcher.captcha_slack === false) return false;

  return Boolean(process.env.SLACK_WEBHOOK_URL?.trim());
}

export async function shouldAutoSolveCaptchaVision(): Promise<boolean> {
  const human = await getHumanEngineScheduleConfig();
  if (human.fingerprint?.captcha_vision_auto !== true) return false;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function shouldNotifyTelegram(): Promise<boolean> {
  const human = await getHumanEngineScheduleConfig();
  if (human.fingerprint?.captcha_telegram === false) return false;

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return false;

  return Boolean(
    process.env.TELEGRAM_CHAT_ID_YEONUN?.trim() ||
      process.env.TELEGRAM_CHAT_ID_QUIZ_PANANA?.trim(),
  );
}
