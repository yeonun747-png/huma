'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { JobScheduleForm, formatScheduledAt, type JobScheduleFormValues } from '@/components/queue/job-schedule-form';
import { MPanel } from '@/components/mockup/primitives';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

type CalJob = { id: string; title: string; job_type: string; status: string; scheduled_at: string };

export function CalendarView() {
  const { workspace } = useWorkspace();
  const [viewDate, setViewDate] = useState(() => new Date());
  const [jobs, setJobs] = useState<CalJob[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const load = useCallback(() => {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    api.calendarJobs({ month: monthStr, workspace }).then(setJobs).catch(() => setJobs([]));
  }, [workspace, year, month]);

  useEffect(() => { load(); }, [load]);

  useRegisterPageAction('openScheduleForm', () => {
    setSelectedDay(today.getMonth() === month && today.getFullYear() === year ? today.getDate() : 1);
    setShowForm(true);
  });

  const jobsByDay = useMemo(() => {
    const map: Record<number, CalJob[]> = {};
    for (const job of jobs) {
      const d = new Date(job.scheduled_at).getDate();
      (map[d] ??= []).push(job);
    }
    return map;
  }, [jobs]);

  const selectedJobs = selectedDay ? jobsByDay[selectedDay] ?? [] : [];

  const defaultScheduleDate = selectedDay
    ? new Date(year, month, selectedDay, 10, 0).toISOString()
    : undefined;

  const handleSchedule = async (values: JobScheduleFormValues) => {
    await api.createJob({
      workspace,
      job_type: values.job_type,
      title: values.title,
      content: values.content || '',
      scheduled_at: new Date(values.scheduled_at).toISOString(),
      status: 'scheduled',
    });
    setShowForm(false);
    load();
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="animate-fadeIn space-y-3">
      <MPanel
        title={`${year}년 ${month + 1}월 · ${workspace}`}
        action={
          <div className="flex gap-1">
            <button type="button" className="btn-ghost px-2 py-0.5 text-[10px]" onClick={() => setViewDate(new Date(year, month - 1, 1))}>◀</button>
            <button type="button" className="btn-ghost px-2 py-0.5 text-[10px]" onClick={() => setViewDate(new Date())}>오늘</button>
            <button type="button" className="btn-ghost px-2 py-0.5 text-[10px]" onClick={() => setViewDate(new Date(year, month + 1, 1))}>▶</button>
          </div>
        }
      >
        <div className="m-cal-grid">
          {DAYS.map((d) => (
            <div key={d} className="m-cal-head">{d}</div>
          ))}
          {cells.map((d, i) => {
            const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const isSelected = selectedDay === d;
            return (
              <button
                key={i}
                type="button"
                disabled={!d}
                onClick={() => { if (d) { setSelectedDay(d); setShowForm(false); } }}
                className={cn(
                  'm-cal-day text-left transition hover:border-huma-acc',
                  isToday && 'today',
                  isSelected && 'ring-1 ring-huma-acc',
                  !d && 'invisible pointer-events-none'
                )}
              >
                {d && (
                  <>
                    <div className="m-cal-num">{d}</div>
                    {(jobsByDay[d] ?? []).slice(0, 3).map((j) => (
                      <div key={j.id} className="m-cal-ev bg-[var(--glow)] text-huma-acc" title={j.title}>
                        {new Date(j.scheduled_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} {j.title}
                      </div>
                    ))}
                    {(jobsByDay[d]?.length ?? 0) > 3 && (
                      <div className="text-[8px] text-huma-t3">+{(jobsByDay[d]?.length ?? 0) - 3}건</div>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </MPanel>

      {selectedDay && (
        <MPanel
          title={`${month + 1}월 ${selectedDay}일 예약`}
          action={
            <button type="button" className="btn-primary px-2 py-0.5 text-[10px]" onClick={() => setShowForm(true)}>+ 이 날짜에 예약</button>
          }
        >
          {selectedJobs.length === 0 ? (
            <p className="text-xs text-huma-t3">예약된 작업이 없습니다.</p>
          ) : (
            <ul className="space-y-1.5">
              {selectedJobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between rounded border border-huma-bdr2 bg-huma-bg3 px-3 py-2 text-xs">
                  <div>
                    <div className="font-medium text-huma-t">{j.title}</div>
                    <div className="font-mono text-[9px] text-huma-t3">{j.job_type} · {formatScheduledAt(j.scheduled_at)}</div>
                  </div>
                  <span className={cn('text-[10px]', j.status === 'scheduled' ? 'text-huma-acc' : 'text-huma-t3')}>{j.status}</span>
                </li>
              ))}
            </ul>
          )}
        </MPanel>
      )}

      {showForm && (
        <JobScheduleForm
          workspace={workspace}
          defaultDate={defaultScheduleDate}
          onSubmit={handleSchedule}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
