'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { MGrid, MPanel, MQueueItem, MStat } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { JobScheduleForm, formatScheduledAt, type JobScheduleFormValues } from './job-schedule-form';

function jobIcon(type: string) {
  if (type.includes('video')) return '🎬';
  if (type.includes('image') || type.includes('social')) return '📸';
  return '📝';
}

function tagFor(job: HumaJob): { label: string; tone: 'live' | 'warn' | 'idle' } {
  if (job.status === 'running') return { label: 'LIVE', tone: 'live' };
  if (job.scheduled_at) return { label: formatScheduledAt(job.scheduled_at).slice(-5), tone: 'warn' };
  return { label: job.status, tone: 'idle' };
}

export function QueueManager() {
  const { workspace } = useWorkspace();
  const [jobs, setJobs] = useState<HumaJob[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    api.jobs({ workspace }).then(setJobs).catch(() => setJobs([]));
  }, [workspace]);

  useEffect(() => { load(); }, [load]);
  useRegisterPageAction('openQueueForm', () => setShowForm(true));

  const stats = useMemo(() => ({
    pending: jobs.filter((j) => j.status === 'pending' || j.status === 'scheduled').length,
    running: jobs.filter((j) => j.status === 'running').length,
    done: jobs.filter((j) => j.status === 'completed').length,
  }), [jobs]);

  const handleCreate = async (values: JobScheduleFormValues) => {
    const scheduledIso = new Date(values.scheduled_at).toISOString();
    const isFuture = new Date(scheduledIso).getTime() > Date.now();
    await api.createJob({
      workspace,
      job_type: values.job_type,
      title: values.title,
      content: values.content || '',
      scheduled_at: isFuture ? scheduledIso : undefined,
      status: isFuture ? 'scheduled' : 'pending',
    });
    setShowForm(false);
    load();
  };

  return (
    <div className="animate-fadeIn">
      <MGrid cols={3}>
        <MStat label="총 대기" value={stats.pending} />
        <MStat label="진행중" value={stats.running} tone="warn" />
        <MStat label="오늘 완료" value={stats.done} tone="ok" />
      </MGrid>

      {showForm && (
        <div className="m-panel">
          <JobScheduleForm workspace={workspace} onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitLabel="큐에 등록" />
        </div>
      )}

      <MPanel
        title="발행 큐"
        action={<button type="button" className="btn-primary text-[10px] px-2 py-1" onClick={() => setShowForm(true)}>+ 작업 추가</button>}
      >
        {jobs.length === 0 ? (
          <div className="py-8 text-center text-sm text-huma-t3">대기 중인 작업이 없습니다</div>
        ) : jobs.map((job) => {
          const tag = tagFor(job);
          return (
            <MQueueItem
              key={job.id}
              icon={jobIcon(job.job_type)}
              title={job.title ?? job.job_type}
              sub={`${job.job_type} · ${job.platform ?? 'naver'}${job.scheduled_at ? ` · ${formatScheduledAt(job.scheduled_at)}` : ''}`}
              tag={tag.label}
              tagTone={tag.tone}
              onRun={() => api.runJob(job.id).then(load)}
              onStop={() => (job.status === 'paused' ? api.resumeJob(job.id) : api.pauseJob(job.id)).then(load)}
            />
          );
        })}
      </MPanel>
    </div>
  );
}
