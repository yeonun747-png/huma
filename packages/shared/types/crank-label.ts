/** CRANK-A, CRANK-B, … (0-indexed, Excel 열 방식) */
export function crankLetterLabel(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `CRANK-${s}`;
}

/** CRANK-A=0, CRANK-B=1, … CRANK-Z=25, CRANK-AA=26 */
export function crankLabelSortKey(label: string | null | undefined): number {
  const raw = (label ?? '').trim();
  const m = /^CRANK-([A-Za-z]+)$/i.exec(raw);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const letters = m[1].toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

export function compareCrankLabels(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ka = crankLabelSortKey(a);
  const kb = crankLabelSortKey(b);
  if (ka !== kb) return ka - kb;
  return String(a ?? '').localeCompare(String(b ?? ''), 'ko');
}

export function crankLabelOf(account: {
  crank_label?: string | null;
  name?: string | null;
}): string {
  return account.crank_label?.trim() || account.name?.trim() || 'C-Rank';
}

export function sortAccountsByCrankLabel<T extends { crank_label?: string | null; name?: string | null }>(
  accounts: T[],
): T[] {
  return [...accounts].sort((a, b) => compareCrankLabels(crankLabelOf(a), crankLabelOf(b)));
}
