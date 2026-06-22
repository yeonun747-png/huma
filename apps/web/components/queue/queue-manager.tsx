'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HumaJob, Workspace } from '@huma/shared';
import { isCaptchaDrillJob, isContentFullPipelineShell } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm } from '@/lib/app-dialog';
import { WS_LABEL } from '@/lib/constants';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { PostingImageModelSettings } from '@/components/settings/posting-image-model-settings';
import { MGrid, MPanel, MQueueItem, MStat, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { useShellViewActive } from '@/components/dashboard/shell-view-active';
import { PostViewerModal } from '@/components/viewer/post-viewer-modal';
import { CrankJobDetailModal } from './crank-job-detail-modal';
import { parseSocialCrankJobContent } from '@/lib/crank-job-payload';
import { parseQueueKstParts, isSchedulePast, isSameKstDay, weekdayColorClass } from '@/lib/format-kst';
import { QueueAutoContentModal, type AutoContentFormValues, type AutoContentSubmitContext } from './queue-auto-content-modal';
import { AutoPublishPanel } from './auto-publish-panel';
import { resolveQueueUploadedImages } from '@/lib/resolve-queue-uploaded-images';
import { buildScheduledAt } from '@/lib/queue-repeat';
import { formatJobErrorLabel } from '@/lib/job-error-label';
import {
  isAbortableQueueJob,
  isDeletableQueueJob,
  isPausableQueueJob,
  isStaleOrFailedQueueJob,
} from '@/lib/queue-job-eligibility';
import { CaptchaCompleteModal } from './captcha-complete-modal';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
      <span className="text-inherit">{parsed.date}</span>
      <span className={weekdayColorClass(parsed.weekday)}>({parsed.weekday})</span>{' '}
      <span className="text-inherit">{parsed.time}</span>
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

function queueScopeLabel(job: HumaJob): string {
  if (job.posting_account_label) return job.posting_account_label;
  return WS_LABEL[job.workspace ?? ''] ?? job.workspace ?? '전체';
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
    const ps = job.platform_schedule as Record<string, unknown> | undefined;
    const steps = (ps?._preview as { steps?: Array<{ id: string; status: string }> } | undefined)?.steps;
    const claude = steps?.find((s) => s.id === 'claude');
    const imagen = steps?.find((s) => s.id === 'imagen');
    parts.push(dryRun ? '검증(dry_run)' : 'Claude 글·Imagen 생성');
    if (job.status === 'running') {
      if (claude?.status === 'running') parts.push('Claude 작성 중');
      else if (imagen?.status === 'running') parts.push('Imagen 생성 중');
      else if (claude?.status === 'ok') parts.push('Claude 완료');
      else parts.push('생성 중');
    } else if (job.status === 'pending' || job.status === 'scheduled') parts.push('생성 대기');
    else if (job.status === 'paused') parts.push('클릭하여 수정');
  } else if (job.content_type === 'B') {
    parts.push('레거시 · 영상 포함');
  } else if (job.content_type) parts.push('네이버 포스팅');
  else if (job.link_url) parts.push('AI 생성');

  parts.push(queueScopeLabel(job));

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
    parts.push(
      job.job_type === 'social_crank'
        ? 'VNC → 로그인 → huma 활동 재개'
        : formatJobErrorLabel(job.error_message) || 'VNC → 발행 → huma 완료',
    );
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

  if (job.status === 'running' && job.job_type === 'post_blog' && job.content) {
    parts.push(`${job.content.length}자 타이핑`);
  } else if (job.status === 'running' && job.job_type === 'content_full' && job.content) {
    parts.push(`본문 ${job.content.length}자`);
  }

  return parts.join(' · ');
}

export function QueueManager() {
  const shellActive = useShellViewActive();
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
  const [accountsTick, setAccountsTick] = useState(0);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const offset = (page - 1) * pageSize;

    const applyCompletedStats = async (base: {
      pending: number;
      running: number;
      doneToday: number;
      doneAll: number;
    }) => {
      try {
        const completed = await api.jobs({ workspace, status: 'completed', limit: '500' });
        const visible = completed.filter((j) => !isContentFullPipelineShell(j));
        return {
          ...base,
          doneToday: visible.filter((j) => isSameKstDay(j.completed_at)).length,
          doneAll: visible.length,
        };
      } catch {
        return base;
      }
    };

    try {
      const result = await api.jobsPage(
        {
          workspace,
          limit: String(pageSize),
          offset: String(offset),
        },
        { force: opts?.force },
      );
      setJobs(result.items);
      setTotal(result.total);
      const stats = await applyCompletedStats(result.stats);
      setStats(stats);
      setLoadError(null);
      setAccountsTick((n) => n + 1);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('huma:queue-updated', { detail: stats }));
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
      const visible = sorted.filter((j) => !isContentFullPipelineShell(j));
      const completed = visible.filter((j) => j.status === 'completed');
      setStats({
        pending: visible.filter((j) => j.status === 'pending' || j.status === 'scheduled').length,
        running:
          visible.filter((j) => j.status === 'running' || j.status === 'awaiting_captcha').length,
        doneToday: completed.filter((j) => isSameKstDay(j.completed_at)).length,
        doneAll: completed.length,
      });
      setTotal(visible.length);
      setJobs(visible.slice(offset, offset + pageSize));
      setLoadError(null);
    } catch {
      setJobs([]);
      setTotal(0);
      setStats({ pending: 0, running: 0, doneToday: 0, doneAll: 0 });
      setLoadError('큐 데이터를 불러오지 못했습니다. 서버 연결을 확인하세요.');
    }
    setAccountsTick((n) => n + 1);
  }, [workspace, page, pageSize]);

  useEffect(() => {
    if (!shellActive) return;
    void load();
    setSelectedIds(new Set());
    const id = setInterval(() => {
      void load({ force: true });
    }, 5000);
    return () => clearInterval(id);
  }, [load, shellActive]);

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

  const visibleJobs = useMemo(
    () => jobs.filter((job) => !isContentFullPipelineShell(job)),
    [jobs],
  );
  const visibleDeletableJobs = useMemo(
    () => visibleJobs.filter(isDeletableQueueJob),
    [visibleJobs],
  );
  const deletableJobs = useMemo(() => visibleDeletableJobs, [visibleDeletableJobs]);
  const staleFailedJobs = useMemo(
    () => visibleJobs.filter(isStaleOrFailedQueueJob),
    [visibleJobs],
  );
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

  const handleAbortJob = async (job: HumaJob) => {
    const msg = `「${job.title ?? job.job_type}」 LIVE 작업을 강제 중단할까요?\n브라우저·동글·계정 락을 해제하고 큐에서 제거합니다.`;
    if (!(await appConfirm(msg, { destructive: true }))) return;
    api
      .abortJob(job.id, { delete: true })
      .then(() => load())
      .catch((e) => void appAlert((e as Error).message));
  };

  const handleDeleteJob = async (job: HumaJob) => {
    const drill = isCaptchaDrillJob(job);
    const captchaHold = job.status === 'awaiting_captcha';
    const msg = drill
      ? `「${job.title ?? job.job_type}」 DRILL을 큐에서 제거할까요?\nVNC 브라우저 세션도 종료됩니다.`
      : captchaHold
        ? `「${job.title ?? job.job_type}」 CAPTCHA 대기 작업을 큐에서 제거할까요?\nVNC 브라우저·동글 세션도 종료됩니다.`
        : `「${job.title ?? job.job_type}」 작업을 큐에서 제거할까요?`;
    if (!(await appConfirm(msg, { destructive: true }))) return;
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
        void appAlert(e instanceof Error ? e.message : '삭제 실패');
      });
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!(await appConfirm(`선택한 ${ids.length}개 작업을 큐에서 제거할까요?`, { destructive: true }))) return;

    setBulkDeleting(true);
    try {
      if (ids.length === 1) {
        await api.deleteJob(ids[0]!);
      } else {
        const result = await api.bulkDeleteJobs(ids);
        if (result.failed > 0) {
          await appAlert(`${result.deleted}개 삭제 · ${result.failed}개 실패\n${result.errors?.join('\n') ?? ''}`);
        }
      }
      setSelectedIds(new Set());
      load();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '일괄 삭제 실패');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handlePreviewSubmit = async (values: AutoContentFormValues, ctx?: AutoContentSubmitContext) => {
    const uploaded_images = await resolveQueueUploadedImages(
      workspace,
      values.uploaded_images,
      ctx?.onUploadProgress,
    );
    const job = await api.createAutoContentJob({
      workspace,
      account_id: values.account_id.trim() || undefined,
      title: values.title.trim() || undefined,
      source_url: values.source_url.trim() || undefined,
      synopsis: values.synopsis.trim() || undefined,
      content_type: 'A',
      content_type_auto: false,
      auto_schedule: values.auto_schedule,
      schedule_time: values.schedule_time,
      uploaded_images,
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

  const handleAutoContentSubmit = async (values: AutoContentFormValues, ctx?: AutoContentSubmitContext) => {
    if (editingJob) {
      const scheduledAt = values.auto_schedule
        ? new Date().toISOString()
        : buildScheduledAt(values.schedule_time);
      const patch: Partial<HumaJob> = {
        title: values.title.trim(),
        link_url: values.source_url.trim(),
        content: values.synopsis.trim() || undefined,
        content_type: 'A',
        content_type_auto: false,
        auto_scheduled: values.auto_schedule,
        scheduled_at: scheduledAt,
      };
      if (workspace === 'yeonun' && values.account_id.trim()) {
        patch.account_id = values.account_id.trim();
      }
      const uploaded = await resolveQueueUploadedImages(
        workspace,
        values.uploaded_images,
        ctx?.onUploadProgress,
      );
      if (uploaded) {
        const prev = (editingJob.image_urls ?? []).join('|');
        const next = uploaded.join('|');
        if (next !== prev) patch.image_urls = uploaded;
      } else if (editingJob.image_urls?.length) {
        patch.image_urls = [];
      }
      await api.updateJob(editingJob.id, patch);
    } else {
      const uploaded_images = await resolveQueueUploadedImages(
        workspace,
        values.uploaded_images,
        ctx?.onUploadProgress,
      );
      await api.createAutoContentJob({
        workspace,
        account_id: values.account_id.trim() || undefined,
        title: values.title.trim() || undefined,
        source_url: values.source_url.trim() || undefined,
        synopsis: values.synopsis.trim() || undefined,
        content_type: 'A',
        content_type_auto: false,
        auto_schedule: values.auto_schedule,
        schedule_time: values.schedule_time,
        uploaded_images,
      });
    }
    setPrefill(null);
    load();
  };

  return (
    <div className="animate-fadeIn">
      <p className="mb-3 text-[12px] leading-relaxed text-huma-t3">
        Claude 글 작성 · Imagen 대표 이미지 생성 · 네이버 블로그 자동 발행 큐입니다. 숏폼 영상 생성·업로드는{' '}
        <Link href="/video-content" className="text-huma-acc hover:underline">
          숏폼 영상 관리
        </Link>
        를 사용하세요.
      </p>

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

      <MGrid cols={2} className="mb-4">
        <PostingImageModelSettings />
        <MPanel title="📋 포스팅 큐 안내">
          <ul className="space-y-2 font-mono text-[11px] leading-relaxed text-huma-t3">
            <li>① Claude Sonnet — 블로그 본문·SEO·해시태그 작성</li>
            <li>② Imagen 4 — 대표 이미지 생성 (직접 업로드 시 생략)</li>
            <li>③ Playwright — 휴먼 엔진 타이핑으로 네이버 발행</li>
            <li className="text-huma-t2">검증 미리보기로 생성 결과 확인 후 포스팅 큐 등록 가능</li>
          </ul>
        </MPanel>
      </MGrid>

      <MGrid cols={4}>
        <MStat label="총 대기" value={stats.pending} />
        <MStat label="진행중" value={stats.running} tone="warn" />
        <MStat label="오늘 완료" value={stats.doneToday} tone="ok" />
        <MStat label="완료 전체" value={stats.doneAll} sub="포스팅 큐 잔여" />
      </MGrid>

      <QueueAutoContentModal
        workspace={workspace}
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
        title="포스팅 큐"
        action={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <AutoPublishPanel workspace={workspace} onDone={load} accountsRefresh={accountsTick} />
            <button type="button" className="btn-ghost btn-sm shrink-0 px-2 py-1" onClick={() => setShowModal(true)}>
              + 포스팅 수동 추가
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
                  포스팅 큐
                  {visibleDeletableJobs.length > 0 ? ` (${visibleDeletableJobs.length})` : ''}
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
                    LIVE는 ■ 강제 중단 · CAPTCHA·실패·지연·완료는 선택 삭제 가능
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
            {visibleJobs.length === 0 ? (
              <div className="py-6 text-center text-sm text-huma-t3">이 페이지에 표시할 작업이 없습니다</div>
            ) : (
              visibleJobs.map((job) => {
            const ws = (job.workspace ?? workspace) as Workspace;
            const canAdvance = ['pending', 'scheduled', 'paused'].includes(job.status);
            const abortable = isAbortableQueueJob(job);
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
                            void appAlert('앞당김 — 큐에 등록했습니다. 잠시 후 LIVE로 바뀌는지 확인하세요.');
                          })
                          .catch((e) => void appAlert((e as Error).message))
                    : undefined
                }
                onStop={
                  abortable
                    ? () => handleAbortJob(job)
                    : pausable
                      ? () =>
                          (job.status === 'paused' ? api.resumeJob(job.id) : api.pauseJob(job.id)).then(() =>
                            load({ force: true }),
                          )
                      : undefined
                }
                stopTitle={abortable ? 'LIVE 강제 중단·삭제' : undefined}
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
