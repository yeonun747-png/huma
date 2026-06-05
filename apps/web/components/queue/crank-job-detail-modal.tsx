'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { HumaJob } from '@huma/shared';
import { crankServiceLabelKo } from '@huma/shared';
import { api } from '@/lib/api';
import {
  blogUrlDisplay,
  crankJobAccountLabel,
  jobStatusLabelKo,
  parseSocialCrankJobContent,
} from '@/lib/crank-job-payload';
import { formatScheduleStartDesc } from './job-schedule-form';
import { formatJobErrorLabel } from '@/lib/job-error-label';

export type CrankJobDetailModalProps = {
  job: HumaJob | null;
  onClose: () => void;
  onDelete?: () => void;
};

type SessionDetail = Awaited<ReturnType<typeof api.crankJobSession>>;

function formatKst(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function formatHm(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function SessionSectionCard({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-huma-bdr bg-huma-bg3">
      <div className="flex items-start justify-between gap-2 border-b border-huma-bdr bg-huma-bg2/70 px-3 py-2.5">
        <h4 className="text-[12.5px] font-semibold text-huma-t1">{title}</h4>
        {meta ? <div className="shrink-0 text-[10px] text-huma-t3">{meta}</div> : null}
      </div>
      <div className="space-y-2.5 p-3">{children}</div>
    </section>
  );
}

function SubPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-huma-bdr bg-huma-bg2/60 p-2.5">
      <div className="mb-1.5 border-b border-huma-bdr/60 pb-1 text-[10px] font-semibold uppercase tracking-wide text-huma-t3">
        {label}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-[11.5px] leading-relaxed text-huma-t3">{message}</p>;
}

function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-huma-bg4 px-1.5 py-0.5 font-mono text-[10px] text-huma-t2">{children}</span>
  );
}

function ActivityList({
  items,
  emptyMessage,
}: {
  items: SessionDetail['our_activity'];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((row) => (
        <li
          key={`${row.url}-${row.type}-${row.at}`}
          className="rounded border border-huma-bdr/70 bg-huma-bg3 px-2 py-1.5 text-[11px]"
        >
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 rounded bg-huma-bg4 px-1 py-0.5 font-mono text-[10px] text-huma-t2">
              {row.type}
            </span>
            <span className="text-huma-t3">{formatHm(row.at)}</span>
          </div>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block truncate font-mono text-huma-acc underline-offset-2 hover:underline"
          >
            {row.title ? `${row.title.slice(0, 40)} · ` : ''}
            {blogUrlDisplay(row.url)} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

export function CrankJobDetailModal({ job, onClose, onDelete }: CrankJobDetailModalProps) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!job) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [job, onClose]);

  useEffect(() => {
    if (!job?.id) {
      setSession(null);
      return;
    }
    setLoading(true);
    void api
      .crankJobSession(job.id)
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, [job?.id]);

  if (!job) return null;

  const payload = parseSocialCrankJobContent(job.content);
  const serviceLabel =
    session?.service_label ??
    (job.workspace ? crankServiceLabelKo(job.workspace) : null) ??
    (loading ? '불러오는 중…' : '미확인');
  const accountName = crankJobAccountLabel(job.title) ?? 'C-Rank 계정';
  const crankLabel = session?.crank_label;
  const sessionMin = payload.sessionMinutes ?? 60;
  const ourTargets = session?.our_blog_targets ?? [];
  const isScheduledAuto = payload.scheduledCrank === true;
  const isLive = job.status === 'running';
  const sessionStarted = session?.session_started ?? Boolean(job.started_at);

  return (
    <div className="m-modal-bg open z-[500]" role="presentation" onClick={onClose}>
      <div
        className="m-modal max-h-[90vh] w-[min(560px,96vw)] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crank-job-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-modal-t flex items-center justify-between gap-2">
          <span id="crank-job-detail-title" className="truncate">
            💬 C-Rank 세션 상세
          </span>
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-1 pb-1 text-[13px] text-huma-t2">
          <div className="rounded-lg border border-huma-bdr bg-huma-bg3 p-3">
            <div className="text-[15px] font-semibold text-huma-t1">
              {crankLabel ? `${crankLabel} · ` : ''}
              {accountName}
            </div>
            <div className="mt-1 font-mono text-[11px] text-huma-t3">
              배정 서비스 {serviceLabel}
              {job.scheduled_at ? ` · ${formatScheduleStartDesc(job.scheduled_at)}` : ''}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={
                  isLive
                    ? 'rounded px-1.5 py-0.5 text-[10px] font-bold text-huma-err bg-[var(--err-bg)]'
                    : 'rounded bg-huma-bg4 px-1.5 py-0.5 text-[10px] text-huma-t2'
                }
              >
                {jobStatusLabelKo(job.status)}
              </span>
              {isScheduledAuto ? (
                <span className="rounded bg-huma-bg4 px-1.5 py-0.5 text-[10px] text-huma-t3">
                  일일 스케줄 자동
                </span>
              ) : (
                <span className="rounded bg-huma-bg4 px-1.5 py-0.5 text-[10px] text-huma-t3">수동 실행</span>
              )}
            </div>
          </div>

          <SessionSectionCard title="이번 세션 계획">
            <ul className="list-inside list-disc space-y-1 text-[12.5px] leading-relaxed text-huma-t2">
              <li>
                <strong className="text-huma-t1">{serviceLabel}</strong> 키워드 → 타 블로그 검색·방문
                <span className="text-huma-t3"> (약 75%)</span>
              </li>
              <li>
                <strong className="text-huma-t1">{serviceLabel}</strong> 포스팅 블로그 방문·공감
                <span className="text-huma-t3"> (약 25%)</span>
              </li>
              <li>
                세션 약 <strong className="text-huma-t1">{sessionMin}분</strong> · 동일 블로그 재방문 최소 5일
              </li>
            </ul>
          </SessionSectionCard>

          <SessionSectionCard
            title={`우리 블로그 · ${serviceLabel}`}
            meta={
              loading ? (
                <span className="text-huma-t3">…</span>
              ) : (
                <span className="flex gap-1">
                  <CountBadge>대상 {ourTargets.length}</CountBadge>
                  <CountBadge>활동 {session?.our_activity.length ?? 0}</CountBadge>
                </span>
              )
            }
          >
            {loading ? (
              <EmptyState message="세션 정보를 불러오는 중…" />
            ) : (
              <>
                <SubPanel label="방문 대상">
                  {ourTargets.length > 0 ? (
                    <ul className="space-y-1">
                      {ourTargets.map((url) => (
                        <li key={url} className="truncate font-mono text-[11px] text-huma-t2">
                          <a href={url} target="_blank" rel="noreferrer" className="text-huma-acc hover:underline">
                            {blogUrlDisplay(url)} ↗
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState message={`${serviceLabel} 포스팅 계정 URL이 등록되지 않았습니다.`} />
                  )}
                </SubPanel>
                <SubPanel label="활동 내역">
                  <ActivityList
                    items={session?.our_activity ?? []}
                    emptyMessage={
                      sessionStarted
                        ? '이번 세션에서 우리 블로그 방문 기록이 아직 없습니다.'
                        : '세션 시작 후 우리 블로그 방문·공감·댓글 내역이 여기 표시됩니다.'
                    }
                  />
                </SubPanel>
              </>
            )}
          </SessionSectionCard>

          <SessionSectionCard
            title="타 블로그 · 자동 탐색"
            meta={
              loading ? (
                <span className="text-huma-t3">…</span>
              ) : (
                <CountBadge>활동 {session?.other_activity.length ?? 0}</CountBadge>
              )
            }
          >
            {loading ? (
              <EmptyState message="세션 정보를 불러오는 중…" />
            ) : (
              <>
                <SubPanel label="탐색 방식">
                  <p className="text-[11.5px] leading-relaxed text-huma-t2">
                    세션 시작 시 <strong className="text-huma-t1">{serviceLabel}</strong> 키워드로 네이버 블로그
                    검색합니다. URL을 미리 정하지 않습니다.
                  </p>
                </SubPanel>
                <SubPanel label="활동 내역">
                  <ActivityList
                    items={session?.other_activity ?? []}
                    emptyMessage={
                      sessionStarted
                        ? '이번 세션에서 타 블로그 방문 기록이 아직 없습니다.'
                        : '세션 시작 후 검색으로 찾은 타 블로그 방문·공감·댓글 내역이 여기 표시됩니다.'
                    }
                  />
                </SubPanel>
              </>
            )}
          </SessionSectionCard>

          {(job.started_at || job.completed_at) && (
            <section className="rounded-lg border border-huma-bdr bg-huma-bg2/50 px-3 py-2 font-mono text-[11px] text-huma-t3">
              {job.started_at ? <div>시작: {formatKst(job.started_at)}</div> : null}
              {job.completed_at ? <div>완료: {formatKst(job.completed_at)}</div> : null}
            </section>
          )}

          {job.error_message ? (
            <div className="rounded-lg border border-huma-err bg-[var(--err-bg)] px-3 py-2 text-[12px] text-huma-err">
              {formatJobErrorLabel(job.error_message)}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-huma-bdr pt-3">
            <Link href="/crank" className="btn-ghost btn-sm" onClick={onClose}>
              C-Rank 소통 관리 →
            </Link>
            {onDelete ? (
              <button type="button" className="btn-ghost btn-sm text-huma-err" onClick={onDelete}>
                큐에서 삭제
              </button>
            ) : null}
            <button type="button" className="btn-ghost btn-sm ml-auto" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
