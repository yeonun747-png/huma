import { supabase } from '../middleware/auth.js';
import { getKstClock, isKstNightBan } from './crank-schedule-config.js';
import { PLATFORM_DAILY_LIMITS } from './limits.js';
import { getHumanEngineConfig, getSetting, type HumanEngineConfig } from './settings.js';

export interface AppSettings {
  claude_api?: boolean;
  higgsfield_api?: boolean;
  slack_webhook?: boolean;
  daily_limit?: boolean;
  night_ban?: boolean;
}

export interface WatcherSettings {
  slack_webhook?: string;
  cooldown_429_min?: number;
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
  daily_limit: true,
  night_ban: true,
  slack_webhook: true,
};

const DEFAULT_WATCHER: WatcherSettings = {
  cooldown_429_min: 15,
  recovery_steps_min: [12, 30, 120],
  auto_pause: true,
  gradual_recovery: true,
};

const POSTING_JOB_TYPES = ['post_blog', 'cafe_new_post'];

export async function getAppSettings(): Promise<AppSettings> {
  return { ...DEFAULT_APP_SETTINGS, ...(await getSetting<AppSettings>('app_settings', {})) };
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
  return isKstNightBan(human.night_ban_start ?? 1, human.night_ban_end ?? 7);
}

/** app_settings.night_ban + human_engine 야간 구간 (KST) */
export async function isNightBanActive(): Promise<boolean> {
  const app = await getAppSettings();
  if (app.night_ban === false) return false;
  return isKstNightBanFromConfig(await getHumanEngineConfig());
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
  return PLATFORM_DAILY_LIMITS[jobType] ?? 30;
}

export async function checkMinPublishInterval(accountId: string, jobType: string): Promise<number | null> {
  if (!POSTING_JOB_TYPES.includes(jobType)) return null;

  const human = await getHumanEngineScheduleConfig();
  const minHours = human.min_publish_interval_hours ?? 4;
  const { data } = await supabase
    .from('huma_jobs')
    .select('completed_at')
    .eq('account_id', accountId)
    .in('job_type', POSTING_JOB_TYPES)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.completed_at) return null;

  const waitMs = minHours * 3600_000 - (Date.now() - new Date(data.completed_at).getTime());
  return waitMs > 0 ? waitMs : null;
}

/** C-Rank 스케줄러 시간창 — active_hours intensity ≥ threshold */
export function deriveActiveHourWindow(
  activeHours: number[],
  minIntensity = 0.25,
): { start: number; end: number } {
  const active: number[] = [];
  for (let h = 0; h < 24; h++) {
    if ((activeHours[h] ?? 0) >= minIntensity) active.push(h);
  }
  if (!active.length) return { start: 8, end: 22 };
  return { start: active[0], end: active[active.length - 1] + 1 };
}

export async function getCrankScheduleWindow(): Promise<{ start: number; end: number }> {
  const human = await getHumanEngineScheduleConfig();
  if (human.active_hours?.length === 24) {
    return deriveActiveHourWindow(human.active_hours);
  }
  return { start: 8, end: 22 };
}

export function resolve429CooldownMs(
  watcher: WatcherSettings,
  human: HumanEngineScheduleConfig,
): number {
  const fpHours = human.fingerprint?.cooldown_429_hours;
  if (typeof fpHours === 'number' && fpHours > 0) {
    return fpHours * 3600_000;
  }
  return (watcher.cooldown_429_min ?? 15) * 60_000;
}

export function resolveRecoveryDelayMs(
  tier: number,
  is429: boolean,
  watcher: WatcherSettings,
  human: HumanEngineScheduleConfig,
): number {
  if (watcher.gradual_recovery === false) {
    return resolve429CooldownMs(watcher, human);
  }

  const steps = watcher.recovery_steps_min ?? [12, 30, 120];
  if (tier >= 3) return (steps[2] ?? 120) * 60_000;
  if (is429 || tier >= 2) return resolve429CooldownMs(watcher, human);
  return (steps[0] ?? 12) * 60_000;
}

export async function shouldNotifySlack(): Promise<boolean> {
  const app = await getAppSettings();
  if (app.slack_webhook === false) return false;

  const human = await getHumanEngineScheduleConfig();
  if (human.fingerprint?.captcha_slack === false) return false;

  return Boolean(process.env.SLACK_WEBHOOK_URL?.trim());
}
