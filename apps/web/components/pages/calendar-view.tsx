'use client';



import { useCallback, useEffect, useMemo, useState } from 'react';

import { useWorkspace } from '@/components/dashboard/workspace-context';

import { JobScheduleForm, type JobScheduleFormValues } from '@/components/queue/job-schedule-form';
import {
  formatScheduledAt,
  formatKstHm,
  kstDatetimeLocalToIso,
  kstDayOfWeek,
  kstDaysInMonth,
  kstToUtcMs,
  kstYearMonthDay,
  parseLogTimestamp,
} from '@/lib/format-kst';

import { MPanel } from '@/components/mockup/primitives';

import { api } from '@/lib/api';

import { cn, WS_LABEL } from '@/lib/constants';

import { PostViewerModal } from '@/components/viewer/post-viewer-modal';



const DAYS = ['일', '월', '화', '수', '목', '금', '토'];



type CalJob = {
  id: string;
  title: string;
  job_type: string;
  status: string;
  scheduled_at: string;
  workspace: string;
  result_url?: string | null;
  completed_at?: string | null;
  content?: string | null;
  image_urls?: string[] | null;
  platform?: string | null;
};



export function CalendarView() {

  const { workspace } = useWorkspace();

  const kstToday = kstYearMonthDay(new Date());
  const [viewYear, setViewYear] = useState(kstToday.year);
  const [viewMonth, setViewMonth] = useState(kstToday.month);

  const [jobs, setJobs] = useState<CalJob[]>([]);

  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [showForm, setShowForm] = useState(false);

  const [viewer, setViewer] = useState<{
    title: string;
    workspace: string;
    isLive?: boolean;
    content?: string | null;
    resultUrl?: string | null;
    completedAt?: string | null;
    imageUrl?: string | null;
  } | null>(null);



  const year = viewYear;

  const month = viewMonth;

  const firstDay = kstDayOfWeek(year, month, 1);

  const daysInMonth = kstDaysInMonth(year, month);



  const load = useCallback(() => {

    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    api.calendarJobs({ month: monthStr, workspace }).then(setJobs).catch(() => setJobs([]));

  }, [workspace, year, month]);



  useEffect(() => {

    load();

  }, [load]);



  const jobsByDay = useMemo(() => {

    const map: Record<number, CalJob[]> = {};

    for (const job of jobs) {

      const parts = kstYearMonthDay(parseLogTimestamp(job.scheduled_at));
      if (parts.year !== year || parts.month !== month) continue;
      (map[parts.day] ??= []).push(job);

    }

    return map;

  }, [jobs, year, month]);



  const selectedJobs = selectedDay ? (jobsByDay[selectedDay] ?? []) : [];



  const openDay = (d: number) => {

    setSelectedDay(d);

    setDrawerOpen(true);

    setShowForm(false);

  };



  const defaultScheduleDate = selectedDay

    ? new Date(kstToUtcMs(year, month + 1, selectedDay, 10, 0)).toISOString()

    : undefined;



  const handleSchedule = async (values: JobScheduleFormValues) => {

    await api.createJob({

      workspace,

      job_type: values.job_type,

      title: values.title,

      content: values.content || '',

      scheduled_at: kstDatetimeLocalToIso(values.scheduled_at),

      status: 'scheduled',

    });

    setShowForm(false);

    load();

  };



  const cells: (number | null)[] = [];

  for (let i = 0; i < firstDay; i++) cells.push(null);

  for (let d = 1; d <= daysInMonth; d++) cells.push(d);



  const wsSummary = (dayJobs: CalJob[]) => {

    const counts: Record<string, number> = {};

    for (const j of dayJobs) {

      const w = j.job_type.includes('video') ? workspace : workspace;

      counts[w] = (counts[w] ?? 0) + 1;

    }

    const n = dayJobs.length;

    if (!n) return null;

    return `${WS_LABEL[workspace] ?? workspace} ${n}건`;

  };



  return (

    <div className="animate-fadeIn">

      <PostViewerModal
        open={Boolean(viewer)}
        title={viewer?.title ?? ''}
        workspace={viewer?.workspace ?? workspace}
        isLive={viewer?.isLive}
        content={viewer?.content}
        resultUrl={viewer?.resultUrl}
        completedAt={viewer?.completedAt}
        imageUrl={viewer?.imageUrl}
        onClose={() => setViewer(null)}
      />

      <MPanel

        title={`${year}년 ${month + 1}월 · ${WS_LABEL[workspace] ?? workspace}`}

        action={

          <div className="flex gap-1">

            <button type="button" className="btn-ghost px-2 py-0.5 text-[10px]" onClick={() => {
              if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
              else setViewMonth((m) => m - 1);
            }}>

              ◀

            </button>

            <button type="button" className="btn-ghost px-2 py-0.5 text-[10px]" onClick={() => {
              const t = kstYearMonthDay(new Date());
              setViewYear(t.year);
              setViewMonth(t.month);
            }}>

              오늘

            </button>

            <button type="button" className="btn-ghost px-2 py-0.5 text-[10px]" onClick={() => {
              if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
              else setViewMonth((m) => m + 1);
            }}>

              ▶

            </button>

          </div>

        }

      >

        <div className="m-cal-grid">

          {DAYS.map((d) => (

            <div key={d} className="m-cal-head">

              {d}

            </div>

          ))}

          {cells.map((d, i) => {

            const isToday = d === kstToday.day && month === kstToday.month && year === kstToday.year;

            const dayJobs = d ? (jobsByDay[d] ?? []) : [];

            const summary = d ? wsSummary(dayJobs) : null;

            const hasJobs = dayJobs.length > 0;

            return (

              <button

                key={i}

                type="button"

                disabled={!d || !hasJobs}

                onClick={() => d && hasJobs && openDay(d)}

                className={cn(

                  'm-cal-day text-left transition',

                  hasJobs && 'hover:border-huma-acc cursor-pointer',

                  !hasJobs && d && 'cursor-default opacity-70',

                  isToday && 'today',

                  selectedDay === d && drawerOpen && 'ring-1 ring-huma-acc',

                  !d && 'invisible pointer-events-none',

                )}

              >

                {d && (

                  <>

                    <div className="m-cal-num">{d}</div>

                    {summary && (

                      <div className="m-cal-ev bg-[var(--glow)] text-huma-acc" title={summary}>

                        {summary} ↗

                      </div>

                    )}

                    {dayJobs.slice(0, 2).map((j) => (

                      <div key={j.id} className="truncate font-mono text-[9px] text-huma-t3" title={j.title}>

                        {formatKstHm(j.scheduled_at)}{' '}

                        {j.title}

                      </div>

                    ))}

                  </>

                )}

              </button>

            );

          })}

        </div>

      </MPanel>



      {drawerOpen && selectedDay && (

        <>

          <button

            type="button"

            className="cal-drawer-overlay open"

            aria-label="드로어 닫기"

            onClick={() => setDrawerOpen(false)}

          />

          <aside className="cal-drawer open">

            <div className="cal-drawer-head">

              <div>

                <div className="font-display text-[16px] tracking-wide text-huma-acc">발행 예약 조감</div>

                <div className="font-mono text-[11px] text-huma-t3">

                  {WS_LABEL[workspace] ?? workspace} · {year}년 {month + 1}월 {selectedDay}일

                </div>

              </div>

              <button type="button" className="btn-ghost btn-sm" onClick={() => setDrawerOpen(false)}>

                ✕

              </button>

            </div>

            <div className="cal-drawer-body">

              <div className="mb-3 flex gap-2">

                <button type="button" className="btn-primary btn-sm" onClick={() => setShowForm(true)}>

                  + 이 날짜에 예약

                </button>

              </div>

              {selectedJobs.length === 0 ? (

                <p className="text-xs text-huma-t3">예약된 작업이 없습니다.</p>

              ) : (

                <ul className="space-y-2">

                  {selectedJobs.map((j) => (

                    <li key={j.id}>
                      <button
                        type="button"
                        className="w-full rounded border border-huma-bdr2 bg-huma-bg3 px-3 py-2.5 text-left transition hover:border-huma-acc"
                        onClick={() =>
                          setViewer({
                            title: j.title,
                            workspace: j.workspace ?? workspace,
                            isLive: j.status === 'running',
                            content: j.content,
                            resultUrl: j.result_url,
                            completedAt: j.completed_at ?? j.scheduled_at,
                            imageUrl: j.image_urls?.[0] ?? null,
                          })
                        }
                      >
                        <div className="text-[13px] font-medium text-huma-t">{j.title}</div>
                        <div className="mt-1 font-mono text-[10.5px] text-huma-t3">
                          {j.job_type} · {formatScheduledAt(j.scheduled_at)} · {j.status}
                          {j.result_url ? ' · 발행 URL 있음' : ''}
                        </div>
                      </button>
                    </li>

                  ))}

                </ul>

              )}

              {showForm && (

                <div className="mt-4 border-t border-huma-bdr pt-4">

                  <JobScheduleForm

                    workspace={workspace}

                    defaultDate={defaultScheduleDate}

                    onSubmit={handleSchedule}

                    onCancel={() => setShowForm(false)}

                  />

                </div>

              )}

            </div>

          </aside>

        </>

      )}

    </div>

  );

}


