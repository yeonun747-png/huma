import { POSTING_DONGLE_SLOTS } from '@huma/shared';

export type YeonunDongleGroup<T> = {
  dongleLabel: string;
  proxyPort: number;
  items: T[];
};

/** 연운1·연운1-2 등 slot_label 순서 (1 → 2 → 3) */
export function compareYeonunAccountLabels(a: string, b: string): number {
  const parse = (raw: string) => {
    const m = raw.trim().match(/^연운(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    return { dongle: Number(m[1]), seq: Number(m[2] ?? '1') };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa && pb) {
    if (pa.dongle !== pb.dongle) return pa.dongle - pb.dongle;
    return pa.seq - pb.seq;
  }
  return a.localeCompare(b, 'ko');
}

/** 연운1 → 연운 1 */
export function formatYeonunDongleGroupLabel(dongleLabel: string): string {
  const m = dongleLabel.trim().match(/^연운(\d+)$/);
  return m ? `연운 ${m[1]}` : dongleLabel;
}

/**
 * UI 표시용 — 연운1·연운1-2 → 연운 1-1 · 연운 1-2
 * DB slot_label(연운1-2)는 그대로 두고 화면만 공백 포맷.
 */
export function formatYeonunAccountDisplayLabel(
  raw: string | undefined | null,
  opts?: { proxyPort?: number; indexInGroup?: number },
): string {
  const label = (raw ?? '').trim();
  const m = label.match(/^연운(\d+)(?:-(\d+))?$/);
  if (m) {
    const dongle = m[1];
    const seq = m[2] ?? '1';
    return `연운 ${dongle}-${seq}`;
  }
  if (opts?.proxyPort != null && opts.proxyPort >= 10001 && opts.proxyPort <= 10003) {
    const dongle = opts.proxyPort - 10000;
    const seq = (opts.indexInGroup ?? 0) + 1;
    return `연운 ${dongle}-${seq}`;
  }
  return label || '연운';
}

/** 연운1~3 동글별 그룹 — proxy_port·slot_label fallback */
export function groupYeonunByDongle<T extends { proxy_port?: number | null; account_label?: string }>(
  rows: T[],
): YeonunDongleGroup<T>[] {
  const yeonunSlots = POSTING_DONGLE_SLOTS.filter((s) => s.workspace === 'yeonun');

  const resolvePort = (row: T): number | null => {
    if (row.proxy_port != null) return row.proxy_port;
    const label = row.account_label ?? '';
    const slot = yeonunSlots.find(
      (s) => label === s.label || label.startsWith(`${s.label}-`),
    );
    return slot?.proxyPort ?? null;
  };

  return yeonunSlots
    .map((slot) => ({
      dongleLabel: slot.label,
      proxyPort: slot.proxyPort,
      items: rows
        .filter((row) => resolvePort(row) === slot.proxyPort)
        .sort((a, b) =>
          compareYeonunAccountLabels(a.account_label ?? '', b.account_label ?? ''),
        ),
    }))
    .filter((g) => g.items.length > 0);
}
