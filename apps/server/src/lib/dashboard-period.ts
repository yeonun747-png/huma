export type DashboardPeriod = 'today' | 'week' | 'month';

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
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setHours(0, 0, 0, 0);
    return {
      start: start.toISOString(),
      end,
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
    };
  }

  if (period === 'week') {
    const start = new Date(now.getTime() - 7 * 86400000);
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - 7 * 86400000);
    return {
      start: start.toISOString(),
      end,
      prevStart: prevStart.toISOString(),
      prevEnd: prevEnd.toISOString(),
    };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    start: start.toISOString(),
    end,
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
  };
}

export function buildChartBuckets(period: DashboardPeriod): Array<{ key: string; label: string }> {
  const now = new Date();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  if (period === 'month') {
    const buckets: Array<{ key: string; label: string }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.push({ key, label: `${d.getMonth() + 1}월` });
    }
    buckets.push({ key: 'forecast', label: '(예상)' });
    return buckets;
  }

  const buckets: Array<{ key: string; label: string }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label =
      period === 'week'
        ? `${d.getMonth() + 1}/${d.getDate()}`
        : dayNames[d.getDay()];
    buckets.push({ key, label });
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
