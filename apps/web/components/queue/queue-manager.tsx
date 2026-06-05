'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaJob, Workspace } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { MGrid, MPanel, MQueueItem, MStat } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { PostViewerModal } from '@/components/viewer/post-viewer-modal';
import { formatScheduleLabel } from './job-schedule-form';
import { QueueAutoContentModal, type AutoContentFormValues } from './queue-auto-content-modal';
import { buildScheduledAt } from '@/lib/queue-repeat';
import type { QueuePrefill } from '@/lib/queue-prefill';

function jobIcon(type: string) {
  if (type.includes('content_full')) return '✨';
  if (type.includes('video')) return '🎬';
  if (type.includes('image') || type.includes('social')) return '📸';
  return '📝';
}

function tagFor(job: HumaJob): { label: string; tone: 'live' | 'warn' | 'idle' } {
  if (job.status === 'running') return { label: 'LIVE', tone: 'live' };
  if (job.scheduled_at) return { label: formatScheduleLabel(job.scheduled_at), tone: 'warn' };
  return { label: job.status, tone: 'idle' };
}

function jobSub(job: HumaJob): string {
  const parts: string[] = [];
  if (job.job_type === 'content_full') {
    parts.push('AI 생성·발행 분배');
    if (['pending', 'scheduled', 'paused'].includes(job.status)) parts.push('클릭하여 수정');
  } else if (job.content_type) parts.push(`타입 ${job.content_type}`);
  else if (job.link_url) parts.push('AI 생성');

  parts.push(WS_LABEL[job.workspace ?? ''] ?? job.workspace ?? '전체');

  if (job.scheduled_at) {
    const scheduleHint =
      job.job_type === 'content_full' && (job.auto_scheduled ?? true) ? '생성 시작' : '발행 예약';
    parts.push(`${formatScheduleLabel(job.scheduled_at)} ${scheduleHint}`);
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
  const [editingJob, setEditingJob] = useState<HumaJob | null>(null);
  const [prefill, setPrefill] = useState<QueuePrefill | null>(null);
  const [viewer, setViewer] = useState<{
    title: string;
    workspace: Workspace;
    isLive?: boolean;
    content?: string | null;
    resultUrl?: string | null;
    completedAt?: string | null;
    imageUrl?: string | null;
    hashtags?: string[] | null;
  } | null>(null);

  const load = useCallback(() => {
    api.jobs({ workspace }).then(setJobs).catch(() => setJobs([]));
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<QueuePrefill>).detail;
      if (!detail?.title) return;
      setPrefill(detail);
      setShowModal(true);
    };
    window.addEventListener('huma:queue-prefill', onPrefill);
    return () => window.removeEventListener('huma:queue-prefill', onPrefill);
  }, []);

  useRegisterPageAction('openQueueForm', () => setShowModal(true));

  const stats = useMemo(
    () => ({
      pending: jobs.filter((j) => j.status === 'pending' || j.status === 'scheduled').length,
      running: jobs.filter((j) => j.status === 'running').length,
      done: jobs.filter((j) => j.status === 'completed').length,
    }),
    [jobs],
  );

  const handleAutoContentSubmit = async (values: AutoContentFormValues) => {
    if (editingJob) {
      const scheduledAt = values.auto_schedule
        ? new Date().toISOString()
        : buildScheduledAt(values.schedule_time);
      const patch: Partial<HumaJob> = {
        title: values.title.trim(),
        link_url: values.source_url.trim(),
        content: values.synopsis.trim() || undefined,
        content_type: values.content_type === 'auto' ? 'A' : values.content_type,
        content_type_auto: values.content_type === 'auto',
        auto_scheduled: values.auto_schedule,
        scheduled_at: scheduledAt,
      };
      if (values.screenshot_base64 && values.screenshot_base64 !== editingJob.image_urls?.[0]) {
        patch.image_urls = [values.screenshot_base64];
      }
      await api.updateJob(editingJob.id, patch);
    } else {
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
    }
    setPrefill(null);
    load();
  };

  const legend = (
    <span className="flex items-center gap-2 font-mono text-[10px] text-huma-t3">
      <span className="text-[#c0506e]">● 연운</span>
      <span className="text-[#5b7fff]">● 퀴즈</span>
      <span className="text-[#00d4ff]">● 파나나</span>
    </span>
  );

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
        hashtags={viewer?.hashtags}
        onClose={() => setViewer(null)}
      />

      <MGrid cols={3}>
        <MStat label="총 대기" value={stats.pending} />
        <MStat label="진행중" value={stats.running} tone="warn" />
        <MStat label="오늘 완료" value={stats.done} tone="ok" />
      </MGrid>

      <QueueAutoContentModal
        open={showModal || editingJob !== null}
        editJob={editingJob}
        prefill={prefill}
        onClose={() => {
          setShowModal(false);
          setEditingJob(null);
          setPrefill(null);
        }}
        onSubmit={handleAutoContentSubmit}
      />

      <MPanel
        title="발행 큐"
        action={
          <div className="flex items-center gap-2">
            {legend}
            <button type="button" className="btn-primary btn-sm px-2 py-1" onClick={() => setShowModal(true)}>
              + 작업 추가
            </button>
          </div>
        }
      >
        {jobs.length === 0 ? (
          <div className="py-8 text-center text-sm text-huma-t3">대기 중인 작업이 없습니다</div>
        ) : (
          jobs.map((job) => {
            const tag = tagFor(job);
            const ws = (job.workspace ?? workspace) as Workspace;
            const canAdvance = ['pending', 'scheduled', 'paused'].includes(job.status);
            return (
              <MQueueItem
                key={job.id}
                icon={jobIcon(job.job_type)}
                title={job.title ?? job.job_type}
                sub={jobSub(job)}
                tag={tag.label}
                tagTone={tag.tone}
                workspaceBorder={ws}
                onClick={() =>
                  setViewer({
                    title: job.title ?? job.job_type,
                    workspace: ws,
                    isLive: job.status === 'running',
                    content: job.content,
                    resultUrl: job.result_url,
                    completedAt: job.completed_at,
                    imageUrl: job.image_urls?.[0] ?? null,
                    hashtags: job.hashtags,
                  })
                }
                onAdvance={
                  canAdvance
                    ? () => api.advanceJob(job.id).then(load).catch((e) => alert((e as Error).message))
                    : undefined
                }
                onStop={() =>
                  (job.status === 'paused' ? api.resumeJob(job.id) : api.pauseJob(job.id)).then(load)
                }
                onDelete={
                  job.status === 'running'
                    ? undefined
                    : () => {
                        if (!window.confirm(`「${job.title ?? job.job_type}」 작업을 큐에서 제거할까요?`)) return;
                        api.deleteJob(job.id).then(load).catch((e) => {
                          alert(e instanceof Error ? e.message : '삭제 실패');
                        });
                      }
                }
              />
            );
          })
        )}
      </MPanel>
    </div>
  );
}
