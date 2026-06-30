import { POSTING_DONGLE_SLOTS } from '@huma/shared';

export type YeonunDongleGroup<T> = {
  dongleLabel: string;
  proxyPort: number;
  items: T[];
};

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
          (a.account_label ?? '').localeCompare(b.account_label ?? '', 'ko'),
        ),
    }))
    .filter((g) => g.items.length > 0);
}
