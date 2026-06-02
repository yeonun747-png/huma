'use client';



import { useCallback, useEffect, useMemo, useState } from 'react';

import type { HumaJob } from '@huma/shared';

import { api } from '@/lib/api';

import { useWorkspace } from '@/components/dashboard/workspace-context';

import { MGrid, MPanel, MQueueItem, MStat } from '@/components/mockup/primitives';

import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

import { formatScheduledAt } from './job-schedule-form';

import { QueueAutoContentModal, type AutoContentFormValues } from './queue-auto-content-modal';

import { repeatLabel } from '@/lib/queue-repeat';



function jobIcon(type: string) {

  if (type.includes('content_full')) return '✨';
  if (type.includes('video')) return '🎬';

  if (type.includes('image') || type.includes('social')) return '📸';

  return '📝';

}



function tagFor(job: HumaJob): { label: string; tone: 'live' | 'warn' | 'idle' } {

  if (job.status === 'running') return { label: 'LIVE', tone: 'live' };

  if (job.scheduled_at) return { label: formatScheduledAt(job.scheduled_at).slice(-5), tone: 'warn' };

  return { label: job.status, tone: 'idle' };

}



function jobSub(job: HumaJob): string {

  const parts: string[] = [];

  if (job.content_type) parts.push(`타입 ${job.content_type}`);
  if (job.link_url) parts.push('AI 생성');

  parts.push(job.platform ?? 'naver');

  if (job.scheduled_at) {

    parts.push(`${formatScheduledAt(job.scheduled_at).slice(-5)} 예약`);

    if (job.repeat_rule) parts.push(`반복: ${repeatLabel(job.repeat_rule)}`);

  }

  if (job.status === 'running' && job.content) {

    parts.push(`${job.content.length}자`);

  }

  return parts.join(' · ');

}



export function QueueManager() {

  const { workspace } = useWorkspace();

  const [jobs, setJobs] = useState<HumaJob[]>([]);

  const [showModal, setShowModal] = useState(false);



  const load = useCallback(() => {

    api.jobs({ workspace }).then(setJobs).catch(() => setJobs([]));

  }, [workspace]);



  useEffect(() => { load(); }, [load]);

  useRegisterPageAction('openQueueForm', () => setShowModal(true));



  const stats = useMemo(() => ({

    pending: jobs.filter((j) => j.status === 'pending' || j.status === 'scheduled').length,

    running: jobs.filter((j) => j.status === 'running').length,

    done: jobs.filter((j) => j.status === 'completed').length,

  }), [jobs]);



  const handleAutoContent = async (values: AutoContentFormValues) => {
    await api.createAutoContentJob({
      workspace,
      title: values.title.trim(),
      source_url: values.source_url.trim(),
      synopsis: values.synopsis.trim() || undefined,
      content_type: values.content_type === 'auto' ? undefined : values.content_type,
      content_type_auto: values.content_type === 'auto',
      auto_schedule: values.auto_schedule,
      schedule_time: values.schedule_time,
      screenshot_base64: values.screenshot_base64,
    });
    load();
  };



  return (

    <div className="animate-fadeIn">

      <MGrid cols={3}>

        <MStat label="총 대기" value={stats.pending} />

        <MStat label="진행중" value={stats.running} tone="warn" />

        <MStat label="오늘 완료" value={stats.done} tone="ok" />

      </MGrid>



      <QueueAutoContentModal

        open={showModal}

        onClose={() => setShowModal(false)}

        onSubmit={handleAutoContent}

      />



      <MPanel

        title="발행 큐"

        action={<button type="button" className="btn-primary btn-sm px-2 py-1" onClick={() => setShowModal(true)}>+ 작업 추가</button>}

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

              sub={jobSub(job)}

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

