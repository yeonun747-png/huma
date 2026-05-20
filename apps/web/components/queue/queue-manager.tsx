'use client';

import { useEffect, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { cn } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { JobScheduleForm, formatScheduledAt, type JobScheduleFormValues } from './job-schedule-form';

const STATUS_TAG: Record<string, string> = {
  pending: 'tag-warn',
  scheduled: 'tag-idle',
  running: 'tag-live',
  completed: 'tag-ok',
  failed: 'tag-err',
  paused: 'tag-idle',
};

export function QueueManager() {
  const { workspace } = useWorkspace();
  const [jobs, setJobs] = useState<HumaJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api.jobs({ workspace }).then(setJobs).catch(() => setJobs([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [workspace]);

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

  const handleRun = async (id: string) => {
    await api.runJob(id);
    load();
  };

  return (
    <div className="animate-fadeIn space-y-3">
      <div className="flex items-center justify-between">
        <div className="panel-title mb-0">발행 큐 · {workspace}</div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? '닫기' : '+ 작업 추가'}
        </Button>
      </div>

      {showForm && (
        <JobScheduleForm
          workspace={workspace}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          submitLabel="큐에 등록"
        />
      )}

      {loading ? (
        <div className="text-sm text-huma-t3">로딩 중...</div>
      ) : jobs.length === 0 ? (
        <div className="panel text-sm text-huma-t3">대기 중인 작업이 없습니다.</div>
      ) : (
        jobs.map((job) => (
          <div key={job.id} className="flex items-center gap-3 rounded-lg border border-huma-bdr2 bg-huma-bg3 px-3 py-2.5 hover:border-huma-acc">
            <span className="text-base">📝</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-huma-t">{job.title ?? job.job_type}</div>
              <div className="font-mono text-[9.5px] text-huma-t3">
                {job.job_type} · {job.platform ?? 'naver'}
                {job.scheduled_at && (
                  <span className="ml-2 text-huma-acc">⏰ {formatScheduledAt(job.scheduled_at)}</span>
                )}
              </div>
            </div>
            <span className={cn(STATUS_TAG[job.status] ?? 'tag-idle')}>{job.status}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => handleRun(job.id)}>▶</Button>
              {job.status === 'paused' ? (
                <Button size="sm" variant="ghost" onClick={() => api.resumeJob(job.id).then(load)}>↻</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => api.pauseJob(job.id).then(load)}>⏸</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => api.deleteJob(job.id).then(load)}>✕</Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
