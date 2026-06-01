/** C-Rank 스케줄러 시뮬레이션 상수 */
export const CRANK_POOL_SIZE = 10;
export const SESSION_DURATION_MINUTES = 60;
export const SESSION_DATA_MB = 7.5;
export const MODEM_MONTHLY_DATA_CAP_MB = 2500;
export const MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY = 6;
export const SCHEDULE_WINDOW_START_HOUR = 8;
export const SCHEDULE_WINDOW_END_HOUR = 22;
export const START_JITTER_MINUTES = 15;
export const RECONNECT_WAIT_MS = 10 * 60 * 1000;

export interface CrankSchedulePolicy {
  activeModemCount: number;
  cycleDays: number;
  dailyAccountCount: number;
  maxSessionsPerModemPerDay: number;
}

/** 활성 crank 동글 수 → 활동 주기·일일 계정 수 */
export function computeCrankSchedulePolicy(activeModemCount: number): CrankSchedulePolicy {
  const n = Math.max(0, activeModemCount);
  if (n <= 2) {
    return {
      activeModemCount: n,
      cycleDays: 3,
      dailyAccountCount: Math.ceil(CRANK_POOL_SIZE / 3),
      maxSessionsPerModemPerDay: MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY,
    };
  }
  if (n <= 4) {
    return {
      activeModemCount: n,
      cycleDays: 2,
      dailyAccountCount: Math.floor(CRANK_POOL_SIZE / 2),
      maxSessionsPerModemPerDay: MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY,
    };
  }
  return {
    activeModemCount: n,
    cycleDays: 2,
    dailyAccountCount: 5,
    maxSessionsPerModemPerDay: MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY,
  };
}

/** 08:00~22:00 KST 균등 분산 + ±15분 지터 */
export function distributeCrankStartTimesKst(
  count: number,
  dayOffset = 0,
): Date[] {
  if (count <= 0) return [];

  const windowMinutes =
    (SCHEDULE_WINDOW_END_HOUR - SCHEDULE_WINDOW_START_HOUR) * 60;
  const interval = windowMinutes / count;

  return Array.from({ length: count }, (_, i) => {
    const baseMinutes =
      SCHEDULE_WINDOW_START_HOUR * 60 + interval * i + interval / 2;
    const jitter =
      (Math.random() * 2 - 1) * START_JITTER_MINUTES;
    const totalMin = Math.round(baseMinutes + jitter);
    const hour = Math.floor(totalMin / 60);
    const minute = totalMin % 60;
    return kstWallClockToUtcDate(hour, minute, dayOffset);
  });
}

/** KST 달력 시각 → UTC Date (한국은 DST 없음) */
export function kstWallClockToUtcDate(
  hour: number,
  minute: number,
  dayOffset = 0,
): Date {
  const parts = getKstYmd(new Date());
  const y = parts.year;
  const m = parts.month;
  const d = parts.day + dayOffset;
  const utcMs = Date.UTC(y, m - 1, d, hour - 9, minute, 0, 0);
  return new Date(utcMs);
}

export function getKstYmd(from = new Date()): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(from).split('-').map(Number);
  return { year: y, month: m, day: d };
}

export function formatKstDateKey(from = new Date()): string {
  const { year, month, day } = getKstYmd(from);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getKstClock(from = new Date()): { hour: number; minute: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    minute: 'numeric',
    day: 'numeric',
    hour12: false,
  }).formatToParts(from);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0);
  return { hour, minute, day };
}

export function addDaysToIso(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
