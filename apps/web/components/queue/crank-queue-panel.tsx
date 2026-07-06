'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HumaJob, Workspace } from '@huma/shared';
import { crankServiceLabelKo } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm } from '@/lib/app-dialog';
import { WS_LABEL } from '@/lib/constants';
import { parseSocialCrankJobContent } from '@/lib/crank-job-payload';
import { formatJobErrorLabel } from '@/lib/job-error-label';
import {
  isSchedulePast,
  isSameKstDay,
  parseQueueKstParts,
  weekdayColorClass,
} from '@/lib/format-kst';
import { MPanel, MQueueItem, MStat, MTag } from '@/components/mockup/primitives';
import { useShellViewActive } from '@/components/dashboard/shell-view-active';
import { CrankJobDetailModal } from './crank-job-detail-modal';
import { CaptchaCompleteModal } from './captcha-complete-modal';
import { isDeletableQueueJob } from '@/lib/queue-job-eligibility';
import { getLogSocket } from '@/lib/socket';

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

function crankJobSub(job: HumaJob): string {
  const parts: string[] = ['블로그 소통 세션'];
  const payload = parseSocialCrankJobContent(job.content);
  parts.push(payload.scheduledCrank ? '일일 스케줄' : '수동');
  const blogCount = payload.ourBlogUrls?.length ?? 0;
  if (blogCount > 0) parts.push(`우리블로그 ${blogCount}곳`);
  parts.push(`약 ${payload.sessionMinutes ?? 25}분`);

  const ws = job.workspace as Workspace | undefined;
  if (ws) parts.push(crankServiceLabelKo(ws) || WS_LABEL[ws] || ws);

  if (job.scheduled_at) {
    parts.push(
      isSchedulePast(job.scheduled_at) ? '미실행·지연' : '세션 시작',
    );
  }

  if (job.status === 'awaiting_captcha') {
    parts.push(formatJobErrorLabel(job.error_message) || 'VNC → 로그인 → huma 활동 재개');
  }
  if (job.status === 'failed' && job.error_message) {
    parts.push(formatJobErrorLabel(job.error_message));
  }
  if (
    ['scheduled', 'pending'].includes(job.status) &&
    job.error_message
  ) {
    parts.push(`재예약 · ${formatJobErrorLabel(job.error_message)}`);
  }

  return parts.join(' · ');
}

function sortCrankJobs(jobs: HumaJob[]): HumaJob[] {
  const rank = (status: string) => {
    if (status === 'running' || status === 'awaiting_captcha') return 0;
    if (['scheduled', 'pending', 'paused'].includes(status)) return 1;
    return 2;
  };
  return [...jobs].sort((a, b) => {
    const ra = rank(a.status);
    const rb = rank(b.status);
    if (ra !== rb) return ra - rb;
    const sa = a.scheduled_at ?? '';
    const sb = b.scheduled_at ?? '';
    if (sa !== sb) return sa.localeCompare(sb);
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

type ServiceFilter = 'all' | Workspace;

export function CrankQueuePanel({ serviceFilter }: { serviceFilter: ServiceFilter }) {
  const shellActive = useShellViewActive();
  const [jobs, setJobs] = useState<HumaJob[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crankJob, setCrankJob] = useState<HumaJob | null>(null);
  const [captchaJob, setCaptchaJob] = useState<HumaJob | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.jobs({ job_type: 'social_crank', limit: '500' });
      setJobs(sortCrankJobs(rows));
      setLoadError(null);
    } catch {
      setLoadError('C-Rank 큐를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    if (!shellActive) return;
    void load();

    const socket = getLogSocket();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleLoad = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(), 350);
    };

    socket.connect();
    socket.on('log', scheduleLoad);
    socket.on('connect', scheduleLoad);

    return () => {
      if (debounce) clearTimeout(debounce);
      socket.off('log', scheduleLoad);
      socket.off('connect', scheduleLoad);
    };
  }, [load, shellActive]);

  const filtered = useMemo(() => {
    if (serviceFilter === 'all') return jobs;
    return jobs.filter((j) => j.workspace === serviceFilter);
  }, [jobs, serviceFilter]);

  const stats = useMemo(() => {
    const completed = filtered.filter((j) => j.status === 'completed');
    return {
      pending: filtered.filter((j) => j.status === 'pending' || j.status === 'scheduled').length,
      running: filtered.filter((j) => j.status === 'running' || j.status === 'awaiting_captcha').length,
      doneToday: completed.filter((j) => isSameKstDay(j.completed_at)).length,
      doneAll: completed.length,
    };
  }, [filtered]);

  const handleDeleteJob = async (job: HumaJob) => {
    const captchaHold = job.status === 'awaiting_captcha';
    const msg = captchaHold
      ? `「${job.title ?? job.job_type}」 CAPTCHA 대기 작업을 큐에서 제거할까요?\nVNC 브라우저·동글 세션도 종료됩니다.`
      : `「${job.title ?? job.job_type}」 C-Rank 작업을 큐에서 제거할까요?`;
    if (!(await appConfirm(msg, { destructive: true }))) return;
    api
      .deleteJob(job.id)
      .then(() => {
        setCrankJob((current) => (current?.id === job.id ? null : current));
        setCaptchaJob((current) => (current?.id === job.id ? null : current));
        void load();
      })
      .catch((e) => void appAlert(e instanceof Error ? e.message : '삭제 실패'));
  };

  return (
    <>
      <CrankJobDetailModal
        job={crankJob}
        onClose={() => setCrankJob(null)}
        onDelete={
          crankJob && isDeletableQueueJob(crankJob) ? () => void handleDeleteJob(crankJob) : undefined
        }
      />
      {captchaJob ? (
        <CaptchaCompleteModal
          job={captchaJob}
          onClose={() => setCaptchaJob(null)}
          onCompleted={() => void load()}
        />
      ) : null}

      <MPanel title="C-Rank 큐">
        <p className="mb-3 text-[11px] leading-relaxed text-huma-t3">
          일일 스케줄·수동 소통 세션 job입니다. 포스팅 발행 큐와 분리되어 있습니다.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MStat label="대기·예약" value={stats.pending} />
          <MStat label="진행중" value={stats.running} tone="warn" />
          <MStat label="오늘 완료" value={stats.doneToday} tone="ok" />
          <MStat label="완료 전체" value={stats.doneAll} />
        </div>
        {loadError ? (
          <div className="mb-2 rounded border border-huma-err/30 bg-huma-err/5 px-3 py-2 text-center text-xs text-huma-err">
            {loadError}
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-sm text-huma-t3">
            {serviceFilter === 'panana'
              ? '파나나 C-Rank 배정 없음 — 연운·퀴즈 워크스페이스를 확인하세요.'
              : '표시할 C-Rank 작업이 없습니다. 00:01 KST 스케줄 또는 수동 실행 후 표시됩니다.'}
          </div>
        ) : (
          filtered.map((job) => {
            const ws = (job.workspace ?? 'yeonun') as Workspace;
            const canAdvance = ['pending', 'scheduled', 'paused'].includes(job.status);
            const deletable = isDeletableQueueJob(job);
            return (
              <MQueueItem
                key={job.id}
                icon="💬"
                title={job.title ?? job.job_type}
                sub={crankJobSub(job)}
                tag=""
                tagTone="idle"
                tagSlot={queueTagSlot(job)}
                workspaceBorder={ws}
                onClick={() => {
                  if (job.status === 'awaiting_captcha') {
                    setCaptchaJob(job);
                    return;
                  }
                  setCrankJob(job);
                }}
                onAdvance={
                  canAdvance
                    ? () =>
                        api
                          .advanceJob(job.id)
                          .then(() => {
                            void load();
                            void appAlert('앞당김 — 큐에 등록했습니다.');
                          })
                          .catch((e) => void appAlert((e as Error).message))
                    : undefined
                }
                onDelete={deletable ? () => void handleDeleteJob(job) : undefined}
              />
            );
          })
        )}
      </MPanel>
    </>
  );
}
