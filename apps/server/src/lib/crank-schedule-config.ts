import { CRANK_PROXY_PORTS } from './modem-ports.js';

/** 레거시 기본값 — 실제 풀 크기는 DB 활성 crank 계정 수 */
export const CRANK_POOL_SIZE_DEFAULT = 50;
export const SESSION_DURATION_MINUTES = 45;
export const SESSION_DATA_MB = 7.5;
export const MODEM_MONTHLY_DATA_CAP_MB = 2500;
export const MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY = 6;
export const SCHEDULE_WINDOW_START_HOUR = 8;
export const SCHEDULE_WINDOW_END_HOUR = 22;
export const START_JITTER_MINUTES = 15;

/**
 * v3.33 — 동글 1트랙 연속 scheduled_at 간격 = 세션 최대 45분.
 * 동글 busy면 worker가 defer — 간격은 목표 시각이며 실제 시작은 큐·모뎀 lock에 따름.
 * 계정 전환 시 reconnect+워밍업(2~5분)은 job 시작 시 자연 소요(규칙 ⑦).
 */
export const SESSION_SLOT_MINUTES = SESSION_DURATION_MINUTES;

/** 병렬 트랙(슬롯6·7) 시작 시차 — 규칙⑦ 자연 간격 2~5분 */
export const PARALLEL_TRACK_STAGGER_MINUTES_MIN = 2;
export const PARALLEL_TRACK_STAGGER_MINUTES_MAX = 5;

export interface CrankScheduleSlot {
  at: Date;
  /** 0=슬롯6(:10006), 1=슬롯7(:10007) */
  track: number;
}

/** track>0 일 때 wave마다 2~5분씩 누적 시차 (동일 분 표시 방지) */
function parallelTrackStaggerMinutes(track: number, wave: number): number {
  if (track <= 0) return 0;
  const span = PARALLEL_TRACK_STAGGER_MINUTES_MAX - PARALLEL_TRACK_STAGGER_MINUTES_MIN + 1;
  const step =
    PARALLEL_TRACK_STAGGER_MINUTES_MIN +
    ((wave * 17 + track * 7) % span);
  return track * step;
}

export interface CrankSchedulePolicy {
  activeModemCount: number;
  cycleDays: number;
  dailyAccountCount: number;
  maxSessionsPerModemPerDay: number;
}

export function proxyPortForCrankTrack(track: number): number {
  const ports = [...CRANK_PROXY_PORTS];
  if (ports.length === 0) return 10006;
  return ports[((track % ports.length) + ports.length) % ports.length]!;
}

/** 활성 crank 동글 수 + 풀 크기 → 활동 주기·일일 계정 수 (i7 7동글: C-Rank 2) */
export function computeCrankSchedulePolicy(
  activeModemCount: number,
  poolSize = CRANK_POOL_SIZE_DEFAULT,
): CrankSchedulePolicy {
  const n = Math.max(0, activeModemCount);
  const pool = Math.max(1, poolSize);
  if (n <= 2) {
    return {
      activeModemCount: n,
      cycleDays: 3,
      dailyAccountCount: Math.min(pool, Math.max(1, Math.ceil(pool / 3))),
      maxSessionsPerModemPerDay: MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY,
    };
  }
  if (n <= 4) {
    return {
      activeModemCount: n,
      cycleDays: 2,
      dailyAccountCount: Math.min(pool, Math.max(1, Math.floor(pool / 2))),
      maxSessionsPerModemPerDay: MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY,
    };
  }
  return {
    activeModemCount: n,
    cycleDays: 2,
    dailyAccountCount: Math.min(pool, 5),
    maxSessionsPerModemPerDay: MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY,
  };
}

function clampScheduleMinute(
  totalMin: number,
  windowStartMin: number,
  windowEndMin: number,
): number {
  return Math.round(Math.min(windowEndMin - 10, Math.max(windowStartMin, totalMin)));
}

/**
 * v3.33 — 08:00~22:00 KST
 * - 계정 i → track i%N, wave floor(i/N)
 * - 같은 트랙 wave 간격: 45분 (SESSION_DURATION_MINUTES)
 * - 병렬 트랙: track1 = track0 + 2~5분 (UI·큐에서 동일 시각 방지)
 * - 반환 순서 = accounts[i] 매핑 순서 (sort 금지)
 */
export function distributeCrankScheduleSlotsKst(
  count: number,
  dayOffset = 0,
  window?: { start: number; end: number },
  modemCount = 1,
  options?: { notBefore?: Date },
): CrankScheduleSlot[] {
  if (count <= 0) return [];

  const startHour = window?.start ?? SCHEDULE_WINDOW_START_HOUR;
  const endHour = window?.end ?? SCHEDULE_WINDOW_END_HOUR;
  let windowStartMin = startHour * 60;
  const windowEndMin = endHour * 60;

  if (options?.notBefore && dayOffset === 0) {
    const { hour, minute } = getKstClock(options.notBefore);
    const nowMin = hour * 60 + minute + 3;
    windowStartMin = Math.max(windowStartMin, nowMin);
  }
  const slotMinutes = SESSION_SLOT_MINUTES;
  const tracks = Math.max(1, Math.floor(modemCount));
  const waveCount = Math.ceil(count / tracks);

  const waveStartMinByWave: number[] = [];

  for (let wave = 0; wave < waveCount; wave++) {
    const jitter0 = (Math.random() * 2 - 1) * START_JITTER_MINUTES;
    const maxStagger = (tracks - 1) * PARALLEL_TRACK_STAGGER_MINUTES_MAX;
    waveStartMinByWave[wave] = clampScheduleMinute(
      windowStartMin + wave * slotMinutes + jitter0,
      windowStartMin,
      windowEndMin - 10 - maxStagger,
    );
  }

  const useFallbackSpread = waveStartMinByWave.some((m) => m > windowEndMin - 20);

  return Array.from({ length: count }, (_, i) => {
    const track = i % tracks;
    const wave = Math.floor(i / tracks);
    let totalMin: number;

    if (useFallbackSpread) {
      const span = windowEndMin - windowStartMin;
      totalMin =
        windowStartMin +
        (span * (i + 1)) / (count + 1) +
        parallelTrackStaggerMinutes(track, wave);
    } else {
      totalMin = waveStartMinByWave[wave]! + parallelTrackStaggerMinutes(track, wave);
    }

    totalMin = clampScheduleMinute(totalMin, windowStartMin, windowEndMin);
    const hour = Math.floor(totalMin / 60);
    const minute = totalMin % 60;

    return {
      track,
      at: kstWallClockToUtcDate(hour, minute, dayOffset),
    };
  });
}

/** @deprecated distributeCrankScheduleSlotsKst 사용 */
export function distributeCrankStartTimesKst(
  count: number,
  dayOffset = 0,
  window?: { start: number; end: number },
  modemCount = 1,
): Date[] {
  return distributeCrankScheduleSlotsKst(count, dayOffset, window, modemCount).map((s) => s.at);
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

export function isKstNightBan(
  nightBanStart = 0,
  nightBanEnd = 7,
  from = new Date(),
): boolean {
  const { hour } = getKstClock(from);
  if (nightBanStart < nightBanEnd) return hour >= nightBanStart && hour < nightBanEnd;
  return hour >= nightBanStart || hour < nightBanEnd;
}

/** KST 야간 금지 종료(예: 07:00)까지 대기 ms — 금지 구간 밖이면 0 */
export function msUntilNightBanEnd(
  nightBanStart = 0,
  nightBanEnd = 7,
  from = new Date(),
): number {
  if (!isKstNightBan(nightBanStart, nightBanEnd, from)) return 0;
  const { hour, minute } = getKstClock(from);
  let hoursToEnd = nightBanEnd - hour;
  if (hoursToEnd <= 0) hoursToEnd += 24;
  return Math.max(60_000, hoursToEnd * 3_600_000 - minute * 60_000);
}

export function addDaysToIso(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
