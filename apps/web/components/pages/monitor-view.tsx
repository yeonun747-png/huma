'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { MGrid, MPanel, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { formatScheduledAt } from '@/components/queue/job-schedule-form';

function jobIcon(type: string) {
  if (type.includes('video')) return '🎬';
  if (type.includes('social') || type.includes('image')) return '📸';
  return '📝';
}

export function MonitorView() {
  const [jobs, setJobs] = useState<HumaJob[]>([]);

  const load = useCallback(() => {
    api.jobs().then((all) => {
      const active = all.filter((j) => j.status === 'running' || j.status === 'scheduled' || j.status === 'pending');
      setJobs(active.slice(0, 4));
    }).catch(() => setJobs([]));
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useRegisterPageAction('refreshMonitor', load);

  return (
    <div className="animate-fadeIn">
      <div className="m-pub-multi">
        {jobs.length === 0 ? (
          <>
            <div className="m-pub-card" style={{ opacity: 0.5 }}>
              <div className="m-pub-top">
                <div className="m-pub-idle-dot" />
                <span className="text-[10.5px] text-huma-t3">대기 중</span>
              </div>
              <div className="py-5 text-center text-[11px] text-huma-t4">활성 발행 세션이 없습니다</div>
            </div>
          </>
        ) : (
          jobs.map((job) => {
            const live = job.status === 'running';
            return (
              <div key={job.id} className="m-pub-card" style={{ opacity: live ? 1 : 0.5 }}>
                <div className="m-pub-top">
                  {live ? <div className="m-pub-live-dot" /> : <div className="m-pub-idle-dot" />}
                  <span className={live ? 'text-[10.5px] font-bold text-huma-err' : 'text-[10.5px] text-huma-t3'}>
                    {live ? 'LIVE' : '대기 중'}
                  </span>
                  <span className="ml-1.5 font-mono text-[11px] text-huma-t3">
                    {job.workspace} · {job.platform ?? 'naver'}
                  </span>
                  {live && <span className="ml-auto font-mono text-[11px] text-huma-t3">WPM —</span>}
                </div>
                {live ? (
                  <>
                    <div className="m-live-box">
                      {job.title ?? job.job_type}
                      <br /><br />
                      {(job.content ?? '').slice(0, 120)}
                      <span className="m-cursor-blink" />
                    </div>
                    <div className="m-pub-meta">
                      <span className="m-pub-m"><span>{(job.content ?? '').length}</span>자</span>
                      <span className="m-pub-m">상태 <span>{job.status}</span></span>
                    </div>
                  </>
                ) : (
                  <div className="py-5 text-center text-[11px] text-huma-t4">
                    {job.title ?? job.job_type}
                    <br /><br />
                    {job.scheduled_at ? `${formatScheduledAt(job.scheduled_at)} 발행 대기` : '큐 대기 중'}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
