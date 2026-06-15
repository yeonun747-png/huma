export type DashboardPeriod = 'today' | 'week' | 'month';

const KST = 'Asia/Seoul';

function kstYmd(from: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(from);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/** KST YYYY-MM-DD */
export function kstDateKeyFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: KST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function kstTodayDateKey(from: Date = new Date()): string {
  const { year, month, day } = kstYmd(from);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** KST 자정 → UTC ISO (jobs API와 동일) */
export function kstTodayStartIso(from: Date = new Date()): string {
  const { year, month, day } = kstYmd(from);
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0)).toISOString();
}

export function kstDayStartIso(daysAgo: number, from: Date = new Date()): string {
  const anchor = kstTodayStartIso(from);
  return new Date(new Date(anchor).getTime() - daysAgo * 86400000).toISOString();
}

export function parseDashboardPeriod(raw?: string): DashboardPeriod {
  if (raw === 'week' || raw === 'month') return raw;
  return 'today';
}

export function getPeriodRange(period: DashboardPeriod): {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
} {
  const now = new Date();
  const end = now.toISOString();

  if (period === 'today') {
    const start = kstTodayStartIso(now);
    const prevEnd = new Date(new Date(start).getTime() - 1).toISOString();
    const prevStart = kstDayStartIso(1, now);
    return { start, end, prevStart, prevEnd };
  }

  if (period === 'week') {
    const start = kstDayStartIso(6, now);
    const prevEnd = new Date(new Date(start).getTime() - 1).toISOString();
    const prevStart = kstDayStartIso(13, now);
    return { start, end, prevStart, prevEnd };
  }

  const { year, month } = kstYmd(now);
  const start = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0)).toISOString();
  const prevEnd = new Date(new Date(start).getTime() - 1).toISOString();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1, -9, 0, 0)).toISOString();
  return { start, end, prevStart, prevEnd };
}

export function buildChartBuckets(
  period: DashboardPeriod,
): Array<{ key: string; label: string; isToday?: boolean }> {
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const todayKey = kstTodayDateKey();

  if (period === 'month') {
    const { year, month } = kstYmd();
    const buckets: Array<{ key: string; label: string; isToday?: boolean }> = [];
    for (let i = 5; i >= 0; i--) {
      let m = month - i;
      let y = year;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      const key = `${y}-${String(m).padStart(2, '0')}`;
      buckets.push({ key, label: `${m}월`, isToday: key === `${year}-${String(month).padStart(2, '0')}` });
    }
    buckets.push({ key: 'forecast', label: '(예상)' });
    return buckets;
  }

  const buckets: Array<{ key: string; label: string; isToday?: boolean }> = [];
  for (let i = 6; i >= 0; i--) {
    const startIso = kstDayStartIso(i);
    const key = kstDateKeyFromIso(startIso);
    if (!key) continue;
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: KST, weekday: 'short' }).format(new Date(startIso));
    const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const label =
      period === 'week'
        ? `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`
        : dayNames[wdMap[wd] ?? 0] ?? key.slice(5);
    buckets.push({ key, label, isToday: key === todayKey });
  }
  return buckets;
}

export function formatKstHm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/** KST YYYY-MM-DD HH:mm:ss */
export function formatKstYmdHms(from: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(from);
}

const KST_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** Claude 글 작성용 — 지금 이 순간(KST)에 올릴 글처럼 쓰게 */
export function formatKstWritingContext(from: Date = new Date()): string {
  const kst = new Date(
    from.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }),
  );
  const y = kst.getFullYear();
  const m = kst.getMonth() + 1;
  const d = kst.getDate();
  const wd = KST_WEEKDAY[kst.getDay()] ?? '';
  const hms = formatKstYmdHms(from).slice(11);
  return `${y}년 ${m}월 ${d}일(${wd}) ${hms} KST`;
}

/** KST YYYY-MM-DD HH:mm */
export function formatKstYmdHm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const full = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso));
    return full.slice(0, 16);
  } catch {
    return null;
  }
}
