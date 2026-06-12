'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { refreshNavBadges } from '@/lib/nav-badge-events';
import { formatScheduledAt } from '@/components/queue/job-schedule-form';

type MonitorSessions = Awaited<ReturnType<typeof api.monitorSessions>>;

export function MonitorView() {
  const [jobs, setJobs] = useState<HumaJob[]>([]);
  const [sessions, setSessions] = useState<MonitorSessions | null>(null);

  const load = useCallback(() => {
    void api.jobs().then((all) => {
      const active = all.filter((j) => j.status === 'running' || j.status === 'scheduled' || j.status === 'pending');
      setJobs(active.slice(0, 4));
    }).catch(() => setJobs([]));

    void api.monitorSessions().then((data) => {
      setSessions(data);
      refreshNavBadges();
    }).catch(() => setSessions(null));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const liveCards = sessions?.live ?? [];
  const idleCard = sessions?.idle;
  const errorCards = sessions?.errors ?? [];

  const shownJobIds = new Set(liveCards.map((c) => c.jobId));

  const apiCards = jobs
    .filter((j) => !shownJobIds.has(j.id))
    .map((job) => {
      const live = job.status === 'running';
      const generating = job.job_type === 'content_full';
      const ps = job.platform_schedule as Record<string, unknown> | undefined;
      const steps = (ps?._preview as { steps?: Array<{ id: string; status: string }> } | undefined)?.steps;
      const claudeRunning = steps?.find((s) => s.id === 'claude')?.status === 'running';
      const imagenRunning = steps?.find((s) => s.id === 'imagen')?.status === 'running';
      const phaseLabel = claudeRunning
        ? 'Claude 글 작성 중'
        : imagenRunning
          ? 'Imagen 생성 중'
          : generating
            ? 'AI 콘텐츠 생성'
            : live
              ? '네이버 타이핑'
              : '대기 중';
      return (
        <div key={job.id} className="m-pub-card" style={{ opacity: live ? 1 : 0.5 }}>
          <div className="m-pub-top">
            {live ? <div className="m-pub-live-dot" /> : <div className="m-pub-idle-dot" />}
            <span className={live ? 'text-[10.5px] font-bold text-huma-err' : 'text-[10.5px] text-huma-t3'}>
              {live ? (generating ? 'AI' : 'LIVE') : '대기'}
            </span>
            <span className="ml-1.5 font-mono text-[11px] text-huma-t3">
              {job.title ?? job.job_type} · {job.workspace} · {generating ? 'Claude/Imagen' : job.platform ?? 'naver'}
            </span>
            {live && !generating && <span className="ml-auto font-mono text-[11px] text-huma-t3">WPM —</span>}
          </div>
          {live ? (
            <>
              <div className="m-live-box">
                {generating ? (
                  <>
                    <span className="text-huma-acc">{phaseLabel}</span>
                    <br />
                    <br />
                    {(job.content ?? '').length > 80
                      ? (job.content ?? '').slice(0, 120)
                      : (job.title ?? '제목 입력됨 · 본문 생성 중…')}
                  </>
                ) : (
                  <>
                    {job.title ?? job.job_type}
                    <br />
                    <br />
                    {(job.content ?? '').slice(0, 120)}
                  </>
                )}
                <span className="m-cursor-blink" />
              </div>
              <div className="m-pub-meta">
                <span className="m-pub-m">
                  <span>{generating ? phaseLabel : `${(job.content ?? '').length}자`}</span>
                  {!generating ? ' 타이핑' : ''}
                </span>
                <span className="m-pub-m">
                  상태 <span>{job.status}</span>
                </span>
              </div>
            </>
          ) : (
            <div className="py-5 text-center text-[11px] text-huma-t4">
              {job.title ?? job.job_type}
              <br />
              <br />
              {job.scheduled_at ? `${formatScheduledAt(job.scheduled_at)} 발행 대기` : '큐 대기 중'}
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="animate-fadeIn">
      <div className="m-pub-multi">
        {liveCards.map((m) => (
          <div key={m.jobId} className="m-pub-card">
            <div className="m-pub-top">
              <div className="m-pub-live-dot" />
              <span className="text-[12px] font-bold text-huma-err">
                {m.jobStatus === 'awaiting_captcha' ? 'CAPTCHA' : 'LIVE'}
              </span>
              <span className="ml-1.5 font-mono text-[11px] text-huma-t3">
                {m.account} · {m.platform}
              </span>
              <span className="ml-auto font-mono text-[11px] text-huma-t3">
                {m.kind === 'crank'
                  ? 'C-Rank'
                  : m.kind === 'generating'
                    ? 'AI 생성'
                    : `${m.wpm} WPM`}
              </span>
            </div>
            <div className="m-live-box whitespace-pre-line">
              {m.kind === 'crank' ? (
                <>
                  {m.crankPhase}
                  {m.crankDetail ? (
                    <>
                      <br />
                      <span className="text-huma-t3">{m.crankDetail}</span>
                    </>
                  ) : null}
                </>
              ) : m.kind === 'generating' ? (
                <>
                  <span className="text-huma-acc">{m.phaseLabel ?? 'Claude 작성 중'}</span>
                  <br />
                  <br />
                  {m.preview}
                </>
              ) : (
                m.preview
              )}
              <span className="m-cursor-blink" />
            </div>
            <div className="m-pub-meta">
              {m.kind === 'crank' ? (
                <>
                  <span className="m-pub-m">
                    단계 <span>{m.crankPhase}</span>
                  </span>
                  <span className="m-pub-m">
                    경과 <span>{m.elapsedMin}</span>분
                  </span>
                  <span className="m-pub-m text-huma-ok">
                    상태 <span>{m.jobStatus === 'awaiting_captcha' ? 'VNC 대기' : '진행'}</span>
                  </span>
                </>
              ) : m.kind === 'generating' ? (
                <>
                  <span className="m-pub-m">
                    단계 <span>{m.phaseLabel ?? 'Claude'}</span>
                  </span>
                  <span className="m-pub-m">
                    경과 <span>{m.elapsedMin}</span>분
                  </span>
                  <span className="m-pub-m text-huma-ok">
                    상태 <span>{m.jobStatus === 'awaiting_captcha' ? 'VNC 대기' : 'AI 생성'}</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="m-pub-m">
                    <span>{m.chars}</span>/{m.totalChars}자
                  </span>
                  <span className="m-pub-m">
                    WPM <span>{m.wpm}</span>
                  </span>
                  <span className="m-pub-m">
                    오타 <span>{m.typos}</span>회
                  </span>
                  <span className="m-pub-m text-huma-ok">
                    완료예상 <span>{m.eta}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        ))}

        {idleCard && (
          <div className="m-pub-card opacity-50">
            <div className="m-pub-top">
              <div className="m-pub-idle-dot" />
              <span className="text-[12px] text-huma-t3">대기 중</span>
              <span className="ml-1.5 font-mono text-[11px] text-huma-t4">
                {idleCard.account} · {idleCard.schedule} 예약
              </span>
            </div>
            <div className="py-5 text-center text-[12.5px] text-huma-t4">
              {idleCard.title}
              <br />
              <br />
              {idleCard.schedule} 발행 대기 중
            </div>
          </div>
        )}

        {errorCards.map((err) => (
          <div key={`${err.account}-${err.sub}`} className="m-pub-card border border-huma-err bg-[var(--err-bg)]">
            <div className="m-pub-top">
              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-huma-err" />
              <span className="text-[12px] font-bold text-huma-err">ERR</span>
              <span className="ml-1.5 font-mono text-[11px] text-huma-t3">
                {err.account} · {err.platform}
              </span>
            </div>
            <div className="px-2.5 py-3.5 text-[12.5px] leading-relaxed text-huma-err">
              {err.detail}
              <br />
              <span className="text-[11px] text-huma-t3">{err.sub}</span>
            </div>
            <div className="flex gap-1.5 border-t border-[rgba(240,82,82,0.2)] px-2.5 pt-2 pb-2.5">
              <Link
                href="/accounts"
                className="flex-1 rounded border border-huma-err bg-transparent py-1 text-center text-[11px] text-huma-err hover:bg-huma-err hover:text-white"
              >
                계정 관리 → 재연결
              </Link>
            </div>
          </div>
        ))}

        {apiCards}
      </div>
    </div>
  );
}
