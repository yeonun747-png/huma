import { parseQueueKstParts, weekdayColorClass } from '@/lib/format-kst';

export function KstWeekdayDatetime({
  iso,
  empty = '스케줄 없음',
  tone = 'muted',
}: {
  iso: string | null | undefined;
  empty?: string;
  /** muted=현재시각, accent=다음발행(강조) */
  tone?: 'muted' | 'accent';
}) {
  const valueClass = tone === 'accent' ? 'text-huma-acc font-bold' : 'text-huma-t2';
  const emptyClass = tone === 'accent' ? 'text-huma-acc font-bold' : 'text-huma-t3';

  if (!iso) return <span className={emptyClass}>{empty}</span>;
  const parsed = parseQueueKstParts(iso);
  if (!parsed) return <span className={emptyClass}>{empty}</span>;
  return (
    <>
      <span className={valueClass}>{parsed.date}</span>
      <span className={weekdayColorClass(parsed.weekday)}>({parsed.weekday})</span>{' '}
      <span className={valueClass}>{parsed.time}</span>
    </>
  );
}
