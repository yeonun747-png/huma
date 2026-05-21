export const REPEAT_OPTIONS = [
  { value: '', label: '없음 (1회)' },
  { value: 'daily', label: '매일' },
  { value: 'weekly-mwf', label: '매주 월·수·금' },
  { value: 'weekly-tuth', label: '매주 화·목' },
  { value: 'custom', label: '커스텀 (cron)' },
] as const;

export type RepeatRule = (typeof REPEAT_OPTIONS)[number]['value'];

export function repeatLabel(rule?: string | null): string {
  return REPEAT_OPTIONS.find((o) => o.value === (rule ?? ''))?.label ?? '없음';
}

export function buildScheduledAt(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h || 10, m || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
