'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HumaJob, Workspace } from '@huma/shared';
import { isCaptchaDrillJob } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { MGrid, MPanel, MQueueItem, MStat, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { PostViewerModal } from '@/components/viewer/post-viewer-modal';
import { CrankJobDetailModal } from './crank-job-detail-modal';
import { parseSocialCrankJobContent } from '@/lib/crank-job-payload';
import { parseQueueKstParts, isSchedulePast, isSameKstDay, weekdayColorClass } from '@/lib/format-kst';
import { QueueAutoContentModal, type AutoContentFormValues } from './queue-auto-content-modal';
import { buildScheduledAt } from '@/lib/queue-repeat';
import { formatJobErrorLabel } from '@/lib/job-error-label';
import {
  isDeletableQueueJob,
  isPausableQueueJob,
  isStaleOrFailedQueueJob,
} from '@/lib/queue-job-eligibility';
import { CaptchaCompleteModal } from './captcha-complete-modal';
import { useSearchParams } from 'next/navigation';
import type { QueuePrefill } from '@/lib/queue-prefill';

const QUEUE_PAGE_SIZE_KEY = 'huma_queue_page_size';
const PAGE_SIZES = [20, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];

function readPageSize(): PageSize {
  if (typeof window === 'undefined') return 20;
  const v = localStorage.getItem(QUEUE_PAGE_SIZE_KEY);
  if (v === '50' || v === '100') return Number(v) as PageSize;
  return 20;
}

function jobIcon(type: string) {
  if (type === 'social_crank') return '💬';
  if (type.includes('content_full')) return '✨';
  if (type.includes('video')) return '🎬';
  if (type.includes('image') || type.includes('social')) return '📸';
  return '📝';
}

function QueueDatetimeLabel({ iso, suffix }: { iso: string; suffix?: string }) {
  const parsed = parseQueueKstParts(iso);
  if (!parsed) return <>—</>;
  return (
    <>
      {parsed.date}
      <span className={weekdayColorClass(parsed.weekday)}>({parsed.weekday})</span> {parsed.time}
      {suffix ? ` · ${suffix}` : null}
    </>
  );
}

function queueDatetimeTag(iso: string, tone: 'warn' | 'err' | 'ok', suffix?: string) {
  const parsed = parseQueueKstParts(iso);
  const title = parsed ? `${parsed.full}${suffix ? ` · ${suffix}` : ''}` : '—';
  return (
    <span title={title}>
      <MTag tone={tone} className="m-tag-datetime">
        <QueueDatetimeLabel iso={iso} suffix={suffix} />
      </MTag>
    </span>
  );
}

function queueTagSlot(job: HumaJob): ReactNode {
  if (job.status === 'awaiting_captcha') return <MTag tone="warn">CAPTCHA</MTag>;
  if (job.status === 'running') return <MTag tone="live">LIVE</MTag>;

  if (job.scheduled_at) {
    const pastPending =
      isSchedulePast(job.scheduled_at) && ['scheduled', 'pending', 'paused'].includes(job.status);
    if (job.status === 'failed') return queueDatetimeTag(job.scheduled_at, 'err', '실패');
    if (pastPending) return queueDatetimeTag(job.scheduled_at, 'err', '지연');
    return queueDatetimeTag(job.scheduled_at, 'warn');
  }

  if (job.status === 'failed') return <MTag tone="err">실패</MTag>;

  if (job.status === 'completed' && job.completed_at) {
    return queueDatetimeTag(job.completed_at, 'ok');
  }

  return <MTag tone="idle">{job.status}</MTag>;
}

function jobSub(job: HumaJob): string {
  const parts: string[] = [];

  if (job.job_type === 'social_crank') {
    parts.push('블로그 소통 세션');
    const payload = parseSocialCrankJobContent(job.content);
    if (payload.scheduledCrank) parts.push('일일 스케줄');
    else parts.push('수동');
    const blogCount = payload.ourBlogUrls?.length ?? 0;
    if (blogCount > 0) parts.push(`우리블로그 ${blogCount}곳`);
    parts.push(`약 ${payload.sessionMinutes ?? 45}분`);
  } else if (job.job_type === 'content_full') {
    const dryRun = (job.platform_schedule as Record<string, unknown> | undefined)?._dry_run === true;
    parts.push(dryRun ? '검증(dry_run)·네이버 미발행' : 'AI 생성·발행 분배');
    if (['pending', 'scheduled', 'paused'].includes(job.status)) parts.push('클릭하여 수정');
  } else if (job.content_type) parts.push(`타입 ${job.content_type}`);
  else if (job.link_url) parts.push('AI 생성');

  parts.push(WS_LABEL[job.workspace ?? ''] ?? job.workspace ?? '전체');

  if (job.scheduled_at) {
    const scheduleHint =
      job.job_type === 'content_full' && (job.auto_scheduled ?? true)
        ? '생성 시작'
        : job.job_type === 'social_crank'
          ? isSchedulePast(job.scheduled_at)
            ? '미실행·지연'
            : '세션 시작'
          : '발행 예약';
    parts.push(scheduleHint);
  }

  if (job.status === 'awaiting_captcha') {
    parts.push(formatJobErrorLabel(job.error_message) || 'VNC → 발행 → huma 완료');
  }

  if (job.status === 'failed' && job.error_message) {
    parts.push(formatJobErrorLabel(job.error_message));
  }

  if (
    job.job_type === 'social_crank' &&
    ['scheduled', 'pending'].includes(job.status) &&
    job.error_message
  ) {
    parts.push(`재예약 · ${formatJobErrorLabel(job.error_message)}`);
  }

  if (job.status === 'running' && job.job_type !== 'social_crank' && job.content) {
    parts.push(`${job.content.length}자`);
  }

  return parts.join(' · ');
}

export function QueueManager() {
  const { workspace } = useWorkspace();
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<HumaJob[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ pending: 0, running: 0, doneToday: 0, doneAll: 0 });
  const [pageSize, setPageSize] = useState<PageSize>(() => readPageSize());
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingJob, setEditingJob] = useState<HumaJob | null>(null);
  const [prefill, setPrefill] = useState<QueuePrefill | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [crankJob, setCrankJob] = useState<HumaJob | null>(null);
  const [captchaJob, setCaptchaJob] = useState<HumaJob | null>(null);
  const [viewer, setViewer] = useState<{
    title: string;
    workspace: Workspace;
    isLive?: boolean;
    content?: string | null;
    contentType?: 'A' | 'B';
    resultUrl?: string | null;
    completedAt?: string | null;
    imageUrl?: string | null;
    hashtags?: string[] | null;
    linkUrl?: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    const offset = (page - 1) * pageSize;
    try {
      const result = await api.jobsPage({
        workspace,
        limit: String(pageSize),
        offset: String(offset),
      });
      setJobs(result.items);
      setTotal(result.total);
      setStats(result.stats);
      setLoadError(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('huma:queue-updated', { detail: result.stats }));
      }
      return;
    } catch {
      /* 구 서버(/api/jobs/page 미배포) — 기존 API로 폴백 */
    }

    try {
      const all = await api.jobs({ workspace, limit: '500' });
      const sorted = [...all].sort((a, b) =>
        String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
      );
      const completed = sorted.filter((j) => j.status === 'completed');
      setStats({
        pending: sorted.filter((j) => j.status === 'pending' || j.status === 'scheduled').length,
        running:
          sorted.filter((j) => j.status === 'running' || j.status === 'awaiting_captcha').length,
        doneToday: completed.filter((j) => isSameKstDay(j.completed_at)).length,
        doneAll: completed.length,
      });
      setTotal(sorted.length);
      setJobs(sorted.slice(offset, offset + pageSize));
      setLoadError(null);
    } catch {
      setJobs([]);
      setTotal(0);
      setStats({ pending: 0, running: 0, doneToday: 0, doneAll: 0 });
      setLoadError('큐 데이터를 불러오지 못했습니다. 서버 연결을 확인하세요.');
    }
  }, [workspace, page, pageSize]);

  useEffect(() => {
    void load();
    setSelectedIds(new Set());
    const id = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const jobId = searchParams.get('job');
    if (!jobId) return;
    const found = jobs.find((j) => j.id === jobId);
    if (found?.status === 'awaiting_captcha') {
      setCaptchaJob(found);
      return;
    }
    void api.getJob(jobId).then((j) => {
      if (j.status === 'awaiting_captcha') setCaptchaJob(j);
    }).catch(() => {});
  }, [searchParams, jobs]);

  useEffect(() => {
    setPage(1);
  }, [workspace, pageSize]);

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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPagination = total > pageSize;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const deletableJobs = useMemo(() => jobs.filter(isDeletableQueueJob), [jobs]);
  const staleFailedJobs = useMemo(() => jobs.filter(isStaleOrFailedQueueJob), [jobs]);
  const selectedCount = selectedIds.size;
  const allDeletableSelected =
    deletableJobs.length > 0 && deletableJobs.every((j) => selectedIds.has(j.id));

  const toggleSelectAll = () => {
    if (allDeletableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(deletableJobs.map((j) => j.id)));
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectStaleFailed = () => {
    setSelectedIds(new Set(staleFailedJobs.filter(isDeletableQueueJob).map((j) => j.id)));
  };

  const handleDeleteJob = (job: HumaJob) => {
    const drill = isCaptchaDrillJob(job);
    const msg = drill
      ? `「${job.title ?? job.job_type}」 DRILL을 큐에서 제거할까요?\nVNC 브라우저 세션도 종료됩니다.`
      : `「${job.title ?? job.job_type}」 작업을 큐에서 제거할까요?`;
    if (!window.confirm(msg)) return;
    api
      .deleteJob(job.id)
      .then(() => {
        setSelectedIds((prev) => {
          if (!prev.has(job.id)) return prev;
          const next = new Set(prev);
          next.delete(job.id);
          return next;
        });
        setCrankJob((current) => (current?.id === job.id ? null : current));
        setCaptchaJob((current) => (current?.id === job.id ? null : current));
        load();
      })
      .catch((e) => {
        alert(e instanceof Error ? e.message : '삭제 실패');
      });
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`선택한 ${ids.length}개 작업을 큐에서 제거할까요?`)) return;

    setBulkDeleting(true);
    try {
      if (ids.length === 1) {
        await api.deleteJob(ids[0]!);
      } else {
        const result = await api.bulkDeleteJobs(ids);
        if (result.failed > 0) {
          alert(`${result.deleted}개 삭제 · ${result.failed}개 실패\n${result.errors?.join('\n') ?? ''}`);
        }
      }
      setSelectedIds(new Set());
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '일괄 삭제 실패');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handlePreviewSubmit = async (values: AutoContentFormValues) => {
    const job = await api.createAutoContentJob({
      workspace,
      title: values.title.trim(),
      source_url: values.source_url.trim(),
      synopsis: values.synopsis.trim() || undefined,
      content_type: values.content_type === 'auto' ? undefined : values.content_type,
      content_type_auto: values.content_type === 'auto',
      auto_schedule: values.auto_schedule,
      schedule_time: values.schedule_time,
      screenshot_base64: values.screenshot_base64,
      dry_run: true,
    });
    const w = Math.min(1440, window.screen.availWidth - 24);
    const h = Math.min(960, window.screen.availHeight - 48);
    const left = Math.max(0, Math.floor((window.screen.availWidth - w) / 2));
    const top = Math.max(0, Math.floor((window.screen.availHeight - h) / 2));
    window.open(
      `/posting-preview?jobId=${encodeURIComponent(job.id)}`,
      '_blank',
      `noopener,noreferrer,width=${w},height=${h},left=${left},top=${top}`,
    );
    load();
  };

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
      <CrankJobDetailModal
        job={crankJob}
        onClose={() => setCrankJob(null)}
        onDelete={
          crankJob && isDeletableQueueJob(crankJob) ? () => handleDeleteJob(crankJob) : undefined
        }
      />

      <PostViewerModal
        open={Boolean(viewer)}
        title={viewer?.title ?? ''}
        workspace={viewer?.workspace ?? workspace}
        isLive={viewer?.isLive}
        content={viewer?.content}
        contentType={viewer?.contentType}
        resultUrl={viewer?.resultUrl}
        completedAt={viewer?.completedAt}
        imageUrl={viewer?.imageUrl}
        hashtags={viewer?.hashtags}
        linkUrl={viewer?.linkUrl}
        onClose={() => setViewer(null)}
      />

      {captchaJob ? (
        <CaptchaCompleteModal
          job={captchaJob}
          onClose={() => setCaptchaJob(null)}
          onCompleted={() => void load()}
        />
      ) : null}

      <MGrid cols={4}>
        <MStat label="총 대기" value={stats.pending} />
        <MStat label="진행중" value={stats.running} tone="warn" />
        <MStat label="오늘 완료" value={stats.doneToday} tone="ok" />
        <MStat label="완료 전체" value={stats.doneAll} sub="큐에 남은 건" />
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
        onPreview={handlePreviewSubmit}
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
        {loadError ? (
          <div className="py-8 text-center text-sm text-huma-t3">{loadError}</div>
        ) : total === 0 && jobs.length === 0 ? (
          <div className="py-8 text-center text-sm text-huma-t3">등록된 작업이 없습니다</div>
        ) : (
          <>
            <div className="m-qi-toolbar">
              <div className="m-qi-toolbar-main">
                <label className="m-qi-select-all">
                  <input
                    type="checkbox"
                    className="m-qi-check"
                    checked={allDeletableSelected}
                    disabled={deletableJobs.length === 0}
                    onChange={toggleSelectAll}
                  />
                  큐 전체
                  {deletableJobs.length > 0 ? ` (${deletableJobs.length})` : ''}
                </label>
                {staleFailedJobs.length > 0 ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={selectStaleFailed}>
                    실패·지연 선택 ({staleFailedJobs.length})
                  </button>
                ) : null}
                {selectedCount > 0 ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-huma-err"
                    disabled={bulkDeleting}
                    onClick={() => void handleBulkDelete()}
                  >
                    {bulkDeleting ? '삭제 중…' : `선택 삭제 (${selectedCount})`}
                  </button>
                ) : (
                  <span className="text-[11px] text-huma-t3">
                    LIVE·CAPTCHA는 DRILL만 삭제 가능 · 그 외는 실패·지연·완료 항목
                  </span>
                )}
              </div>
              <label className="m-qi-page-size">
                표시
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value) as PageSize;
                    setPageSize(next);
                    localStorage.setItem(QUEUE_PAGE_SIZE_KEY, String(next));
                  }}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}개
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {jobs.length === 0 ? (
              <div className="py-6 text-center text-sm text-huma-t3">이 페이지에 표시할 작업이 없습니다</div>
            ) : (
              jobs.map((job) => {
            const ws = (job.workspace ?? workspace) as Workspace;
            const canAdvance = ['pending', 'scheduled', 'paused'].includes(job.status);
            const deletable = isDeletableQueueJob(job);
            const pausable = isPausableQueueJob(job);
            return (
              <MQueueItem
                key={job.id}
                icon={jobIcon(job.job_type)}
                title={job.title ?? job.job_type}
                sub={jobSub(job)}
                tag=""
                tagTone="idle"
                tagSlot={queueTagSlot(job)}
                workspaceBorder={ws}
                selectable={deletable}
                checked={selectedIds.has(job.id)}
                onSelectChange={(checked) => toggleSelect(job.id, checked)}
                onClick={() => {
                  if (job.status === 'awaiting_captcha') {
                    setCaptchaJob(job);
                    return;
                  }
                  if (job.job_type === 'social_crank') {
                    setCrankJob(job);
                    return;
                  }
                  setViewer({
                    title: job.title ?? job.job_type,
                    workspace: ws,
                    isLive: job.status === 'running',
                    content: job.content,
                    contentType: job.content_type_auto ? 'A' : (job.content_type ?? 'A'),
                    resultUrl: job.result_url,
                    completedAt: job.completed_at,
                    imageUrl: job.image_urls?.[0] ?? null,
                    hashtags: job.hashtags,
                    linkUrl: job.link_url,
                  });
                }}
                onAdvance={
                  canAdvance
                    ? () =>
                        api
                          .advanceJob(job.id)
                          .then(() => {
                            void load();
                            alert('앞당김 — 큐에 등록했습니다. 잠시 후 LIVE로 바뀌는지 확인하세요.');
                          })
                          .catch((e) => alert((e as Error).message))
                    : undefined
                }
                onStop={
                  pausable
                    ? () =>
                        (job.status === 'paused' ? api.resumeJob(job.id) : api.pauseJob(job.id)).then(load)
                    : undefined
                }
                onDelete={deletable ? () => handleDeleteJob(job) : undefined}
              />
            );
          })
            )}
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-huma-bdr2 pt-3">
              {showPagination ? (
                <div className="flex items-center gap-2 font-mono text-[11px] text-huma-t3">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ◀
                  </button>
                  <span>
                    {page} / {totalPages}
                    <span className="ml-1 text-huma-t4">· 전체 {total}건</span>
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    ▶
                  </button>
                </div>
              ) : (
                <span className="font-mono text-[11px] text-huma-t4">전체 {total}건</span>
              )}
            </div>
          </>
        )}
      </MPanel>
    </div>
  );
}
