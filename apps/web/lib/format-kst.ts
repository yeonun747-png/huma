const KST = 'Asia/Seoul';

type Ymd = { year: number; month: number; day: number };

function kstParts(d: Date, fields: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('en-CA', { timeZone: KST, ...fields }).formatToParts(d);
}

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** huma_logs · job scheduled_at 등 — offset 없으면 UTC(TIMESTAMPTZ)로 간주 */
export function parseLogTimestamp(raw: string | null | undefined): Date {
  if (!raw) return new Date(NaN);
  const s = String(raw).trim();
  if (!s) return new Date(NaN);

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return new Date(n < 1e12 ? n * 1000 : n);
  }

  const normalized = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
  if (/[zZ]$/.test(normalized) || /[+-]\d{2}(:\d{2})?$/.test(normalized)) {
    return new Date(normalized);
  }

  return new Date(`${normalized}Z`);
}

/** KST 달력 연·월(0-indexed)·일 */
export function kstYearMonthDay(from: Date = new Date()): Ymd {
  const parts = kstParts(from, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return {
    year: Number(pick(parts, 'year')),
    month: Number(pick(parts, 'month')) - 1,
    day: Number(pick(parts, 'day')),
  };
}

/** KST wall clock → UTC ms (KST=UTC+9, DST 없음) */
export function kstToUtcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour - 9, minute, second);
}

export function kstDaysInMonth(year: number, monthIndex: number): number {
  for (let day = 31; day >= 28; day -= 1) {
    const { year: y, month: m } = kstYearMonthDay(new Date(kstToUtcMs(year, monthIndex + 1, day, 12, 0)));
    if (y === year && m === monthIndex) return day;
  }
  return 30;
}

/** KST 기준 요일 0=일 … 6=토 */
export function kstDayOfWeek(year: number, monthIndex: number, day: number): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: KST, weekday: 'short' }).format(
    new Date(kstToUtcMs(year, monthIndex + 1, day, 12, 0)),
  );
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

/** KST YYYY-MM-DD */
export function kstDateKey(from: Date = new Date()): string {
  const { year, month, day } = kstYearMonthDay(from);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function logKstDateKey(iso: string | null | undefined): string | null {
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return null;
  return kstDateKey(d);
}

function kstCalendarDayDiff(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((fromMs - toMs) / 86_400_000);
}

export function isSameKstDay(iso: string | null | undefined, ref: Date = new Date()): boolean {
  const key = logKstDateKey(iso);
  return key !== null && key === kstDateKey(ref);
}

/** Operation Log · Watcher — KST YYYY-MM-DD HH:mm:ss */
export function formatLogKst(iso: string | null | undefined): string {
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: KST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '—';
  }
}

/** 큐 카드 · 헤더 시계 — 요일 색 (평일 초록 / 토 파랑 / 일 빨강) */
export function weekdayColorClass(weekday: string): string {
  const wd = weekday.replace(/\.$/, '').trim();
  if (wd.startsWith('일')) return '!text-huma-err font-bold';
  if (wd.startsWith('토')) return '!text-huma-blue font-bold';
  return '!text-huma-ok font-bold';
}

/** 큐 카드 태그 — KST YYYY-MM-DD(요일) HH:mm:ss */
export type QueueKstParts = { date: string; weekday: string; time: string; full: string };

export function parseQueueKstParts(iso: string | null | undefined): QueueKstParts | null {
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const dateParts = kstParts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
    const y = pick(dateParts, 'year');
    const m = pick(dateParts, 'month');
    const day = pick(dateParts, 'day');
    const weekday = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, weekday: 'short' })
      .format(d)
      .replace(/\.$/, '');
    const time = formatLogKstTime(iso);
    const date = `${y}-${m}-${day}`;
    return { date, weekday, time, full: `${date}(${weekday}) ${time}` };
  } catch {
    return null;
  }
}

export function formatQueueKst(iso: string | null | undefined): string {
  return parseQueueKstParts(iso)?.full ?? '—';
}

export function formatLogKstTime(iso: string | null | undefined): string {
  const full = formatLogKst(iso);
  if (full === '—') return full;
  const space = full.indexOf(' ');
  return space >= 0 ? full.slice(space + 1) : full;
}

/** 헤더 실시간 시계 HH:mm:ss (KST) — @deprecated formatKstYmdHms 사용 */
export function formatKstClock(from: Date = new Date()): string {
  const parts = kstParts(from, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${pick(parts, 'hour')}:${pick(parts, 'minute')}:${pick(parts, 'second')}`;
}

/** 헤더 실시간 시계 — KST YYYY-MM-DD HH:mm:ss */
export function formatKstYmdHms(from: Date = new Date()): string {
  const dateParts = kstParts(from, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeParts = kstParts(from, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${pick(dateParts, 'year')}-${pick(dateParts, 'month')}-${pick(dateParts, 'day')} ${pick(timeParts, 'hour')}:${pick(timeParts, 'minute')}:${pick(timeParts, 'second')}`;
}

/** 다음 발행 등 — KST YYYY-MM-DD HH:mm */
export function formatKstYmdHm(iso: string | null | undefined): string {
  const full = formatLogKst(iso);
  if (full === '—') return '스케줄 없음';
  return full.slice(0, 16);
}

export function formatKstHm(iso: string | null | undefined): string {
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = kstParts(d, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${pick(parts, 'hour')}:${pick(parts, 'minute')}`;
}

export function formatKstDate(iso: string | null | undefined): string {
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(d);
}

export function formatKstDateTime(iso: string | null | undefined): string {
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** 월·일·시각 (캘린더·모니터) */
export function formatScheduledAt(iso?: string | null): string {
  if (!iso) return '—';
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** 큐 카드 — 오늘/내일/날짜 + KST 시각 */
export function formatScheduleLabel(iso?: string): string {
  if (!iso) return '—';
  const d = parseLogTimestamp(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dayKey = logKstDateKey(iso);
  if (!dayKey) return '—';
  const diffDays = kstCalendarDayDiff(dayKey, kstDateKey());
  const time = formatKstHm(iso);
  if (diffDays === 0) return `오늘 ${time}`;
  if (diffDays === 1) return `내일 ${time}`;
  if (diffDays === -1) return `어제 ${time}`;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function isSchedulePast(iso?: string): boolean {
  if (!iso) return false;
  const d = parseLogTimestamp(iso);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export function formatScheduleStartDesc(iso?: string): string {
  if (!iso) return '—';
  const when = formatScheduleLabel(iso);
  return isSchedulePast(iso) ? `${when} 예정 시각` : `${when} 시작 예정`;
}

export function formatScheduleQueueTag(iso: string | undefined, status: string): string {
  if (!iso) return status;
  const when = formatScheduleLabel(iso);
  if (isSchedulePast(iso) && (status === 'scheduled' || status === 'pending')) {
    return `${when} · 지연`;
  }
  if (status === 'failed') return `${when} · 실패`;
  return when;
}

/** datetime-local 입력값 — KST 기준 */
export function toKstDatetimeLocalValue(iso?: string): string {
  const d = iso ? parseLogTimestamp(iso) : new Date();
  if (Number.isNaN(d.getTime())) return toKstDatetimeLocalValue(undefined);
  const parts = kstParts(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${pick(parts, 'year')}-${pick(parts, 'month')}-${pick(parts, 'day')}T${pick(parts, 'hour')}:${pick(parts, 'minute')}`;
}

/** datetime-local(KST) → ISO UTC */
export function kstDatetimeLocalToIso(local: string): string {
  const [datePart, timePart = '00:00'] = local.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  return new Date(kstToUtcMs(y, m, d, h, min)).toISOString();
}

/** KST HH:mm — 자동 스케줄 시간 입력 */
export function extractKstScheduleTime(iso?: string): string {
  if (!iso) return '10:00';
  return formatKstHm(iso);
}

/** KST 오늘·내일 기준 예약 ISO (queue-repeat) */
export function buildScheduledAtKst(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const { year, month, day } = kstYearMonthDay(new Date());
  let utcMs = kstToUtcMs(year, month + 1, day, h || 10, m || 0);
  if (utcMs <= Date.now()) {
    const next = kstYearMonthDay(new Date(utcMs + 86_400_000));
    utcMs = kstToUtcMs(next.year, next.month + 1, next.day, h || 10, m || 0);
  }
  return new Date(utcMs).toISOString();
}
