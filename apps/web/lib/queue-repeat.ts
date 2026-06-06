import { buildScheduledAtKst } from '@/lib/format-kst';

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
  return buildScheduledAtKst(time);
}
