'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/dashboard/app-shell';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { JobScheduleForm, formatScheduledAt, type JobScheduleFormValues } from '@/components/queue/job-schedule-form';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

type CalJob = { id: string; title: string; job_type: string; status: string; scheduled_at: string };

function CalendarContent() {
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
    <div className="animate-fadeIn space-y-4">
      <div className="panel">
        <div className="mb-3 flex items-center justify-between">
          <div className="panel-title mb-0">{year}년 {month + 1}월 · {workspace}</div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setViewDate(new Date(year, month - 1, 1))}>◀</Button>
            <Button size="sm" variant="ghost" onClick={() => setViewDate(new Date())}>오늘</Button>
            <Button size="sm" variant="ghost" onClick={() => setViewDate(new Date(year, month + 1, 1))}>▶</Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DAYS.map((d) => (
            <div key={d} className="py-1 text-center font-mono text-[9px] text-huma-t3">{d}</div>
          ))}
          {cells.map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { if (d) { setSelectedDay(d); setShowForm(false); } }}
              className={cn(
                'min-h-[72px] rounded border p-1 text-left text-[10px] transition hover:border-huma-acc',
                d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
                  ? 'border-huma-acc bg-[var(--glow)]'
                  : 'border-huma-bdr2',
                selectedDay === d && 'ring-1 ring-huma-acc'
              )}
            >
              {d && (
                <>
                  <span className="font-mono text-huma-t2">{d}</span>
                  <div className="mt-0.5 space-y-0.5">
                    {(jobsByDay[d] ?? []).slice(0, 3).map((j) => (
                      <div key={j.id} className="truncate rounded bg-huma-bg3 px-1 py-px text-[8px] text-huma-acc" title={j.title}>
                        {new Date(j.scheduled_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} {j.title}
                      </div>
                    ))}
                    {(jobsByDay[d]?.length ?? 0) > 3 && (
                      <div className="text-[8px] text-huma-t3">+{(jobsByDay[d]?.length ?? 0) - 3}건</div>
                    )}
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {selectedDay && (
        <div className="panel space-y-3">
          <div className="flex items-center justify-between">
            <div className="panel-title mb-0">{month + 1}월 {selectedDay}일 예약</div>
            <Button size="sm" onClick={() => setShowForm(true)}>+ 이 날짜에 예약</Button>
          </div>
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
        </div>
      )}

      {showForm && selectedDay && (
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

export default function CalendarPage() {
  return (
    <AppShell title="스케줄 캘린더">
      <CalendarContent />
    </AppShell>
  );
}
