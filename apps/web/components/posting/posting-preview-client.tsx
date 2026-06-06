'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ContentType, HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';
import {
  getPreviewImagenError,
  isPreviewImagenDone,
  resolvePreviewImageUrl,
} from '@/lib/preview-image-url';
import { normalizeBlogLink, prepareBodyForTypingSim } from '@/lib/naver-post-sanitize';
import { PlaywrightPostingReplay } from '@/components/posting/playwright-posting-replay';

type PreviewStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'ok' | 'err';
  detail?: string;
  ms?: number;
};

function stepsFromJob(job: HumaJob | null): PreviewStep[] {
  const ps = job?.platform_schedule as Record<string, unknown> | undefined;
  const preview = ps?._preview as { steps?: PreviewStep[] } | undefined;
  if (preview?.steps?.length) return preview.steps;
  if (job?.status === 'running') {
    return [
      { id: 'claude', label: 'Claude Sonnet', status: 'running' },
      { id: 'imagen', label: 'Imagen 4', status: 'pending' },
    ];
  }
  return [
    { id: 'claude', label: 'Claude Sonnet', status: 'pending' },
    { id: 'imagen', label: 'Imagen 4', status: 'pending' },
    { id: 'typing', label: '네이버 타이핑 시뮬', status: 'pending' },
  ];
}

function StepIcon({ status }: { status: PreviewStep['status'] }) {
  if (status === 'ok') return <span className="text-huma-ok">✓</span>;
  if (status === 'err') return <span className="text-huma-err">✕</span>;
  if (status === 'running') return <span className="animate-pulse text-huma-warn">●</span>;
  return <span className="text-huma-t3">○</span>;
}

function resolveContentType(job: HumaJob): ContentType {
  if (!job.content_type_auto && job.content_type) return job.content_type;
  return job.content_type ?? 'A';
}

function previewFingerprint(job: HumaJob): string {
  const ps = job.platform_schedule as Record<string, unknown> | undefined;
  const steps = (ps?._preview as { steps?: PreviewStep[] } | undefined)?.steps;
  const imagen = steps?.find((s) => s.id === 'imagen');
  return [
    job.status,
    job.content?.length ?? 0,
    job.image_urls?.[0] ?? '',
    imagen?.status ?? '',
    imagen?.detail ?? '',
  ].join('|');
}

export function PostingPreviewClient({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<HumaJob | null>(null);
  const [error, setError] = useState('');
  const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const stopPolling = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = async () => {
      try {
        const row = await api.getJob(jobId);
        if (cancelled) return;
        setJob((prev) => {
          if (prev && previewFingerprint(prev) === previewFingerprint(row)) return prev;
          return row;
        });
        if (row.status === 'failed') {
          setError(row.error_message ?? '작업 실패');
          stopPolling();
          return;
        }
        const imagenDone = isPreviewImagenDone(row);
        const hasContent = Boolean(row.content && row.content.length > 100);
        const hasImage = Boolean(resolvePreviewImageUrl(row));
        const imagenFailed = Boolean(getPreviewImagenError(row));
        if (row.status === 'completed' && hasContent && imagenDone && (hasImage || imagenFailed)) {
          stopPolling();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '조회 실패');
      }
    };

    void poll();
    intervalId = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [jobId]);

  const steps = useMemo(() => stepsFromJob(job), [job]);
  const ws = (job?.workspace ?? 'yeonun') as keyof typeof WS_LABEL;
  const previewImageUrl = resolvePreviewImageUrl(job);
  const imagenError = getPreviewImagenError(job);
  const imagenDone = isPreviewImagenDone(job);
  const contentReady = Boolean(job?.content && job.content.length > 100);
  const jobDone = job?.status === 'completed';
  const dryRun = (job?.platform_schedule as Record<string, unknown> | undefined)?._dry_run === true;
  const promoted = (job?.platform_schedule as Record<string, unknown> | undefined)?._promoted as
    | { blog_job_id?: string; promoted_at?: string }
    | undefined;
  const contentType = job ? resolveContentType(job) : 'A';

  useEffect(() => {
    if (!previewImageUrl || !jobDone || !imagenDone) {
      setDisplayImageUrl(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        objectUrl = await api.fetchJobPreviewImageObjectUrl(jobId);
        if (!cancelled) setDisplayImageUrl(objectUrl);
      } catch {
        if (!cancelled) setDisplayImageUrl(previewImageUrl);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [jobId, previewImageUrl, jobDone, imagenDone]);

  const readyForTyping =
    jobDone && contentReady && imagenDone && Boolean(displayImageUrl) && !imagenError;

  const waitingForImagen = jobDone && contentReady && !imagenDone && !imagenError;

  const canPublishFromPreview =
    jobDone &&
    contentReady &&
    imagenDone &&
    Boolean(displayImageUrl) &&
    !imagenError &&
    dryRun &&
    !promoted?.blog_job_id;

  const handlePublishFromPreview = async () => {
    setPublishMsg('');
    setPublishing(true);
    try {
      const result = await api.publishFromPreview(jobId);
      setPublishMsg(`발행 큐 등록 완료 · post_blog ${result.blog_job_id.slice(0, 8)}…`);
      const row = await api.getJob(jobId);
      setJob(row);
    } catch (e) {
      setPublishMsg(e instanceof Error ? e.message : '발행 큐 등록 실패');
    } finally {
      setPublishing(false);
    }
  };

  const simulatorKey =
    readyForTyping && job
      ? `${job.id}-${job.content?.length ?? 0}-${displayImageUrl}`
      : jobId;

  return (
    <div
      className={
        readyForTyping
          ? 'flex h-screen min-h-[720px] flex-col overflow-hidden px-2 py-2'
          : 'min-h-screen px-3 py-4 text-huma-t sm:px-4 sm:py-6'
      }
    >
      <div className={readyForTyping ? 'flex min-h-0 flex-1 flex-col' : 'mx-auto max-w-3xl'}>
        {(canPublishFromPreview || promoted?.blog_job_id || publishMsg) && (
          <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-huma-bdr bg-huma-bg2 px-3 py-2">
            <span className="text-[11px] text-huma-t2">
              {promoted?.blog_job_id
                ? `✓ 발행 큐 등록됨 · ${promoted.blog_job_id.slice(0, 8)}…`
                : '검증 OK → Claude/Imagen 재생성 없이 네이버 발행 큐에 넣기'}
            </span>
            {canPublishFromPreview ? (
              <button
                type="button"
                className="btn-primary btn-sm shrink-0 px-4"
                disabled={publishing}
                onClick={() => void handlePublishFromPreview()}
              >
                {publishing ? '등록 중…' : '🚀 발행 큐 등록'}
              </button>
            ) : null}
          </div>
        )}
        {publishMsg && !promoted?.blog_job_id && (
          <p className={`mb-2 text-center text-[11px] ${publishMsg.includes('완료') ? 'text-huma-ok' : 'text-huma-err'}`}>
            {publishMsg}
          </p>
        )}

        {!readyForTyping && (
          <div className="mb-4 rounded-lg border border-huma-acc/40 bg-huma-glow px-4 py-3">
            <div className="text-sm font-semibold text-huma-acc">🔍 포스팅 검증 모드</div>
            <div className="mt-1 text-[12px] text-huma-t2">
              Playwright <code className="text-[11px]">postNaverBlog()</code> 와 동일 순서·휴먼엔진 설정으로 재현합니다.{' '}
              <strong className="text-huma-warn">실제 발행하지 않습니다.</strong>
            </div>
            {job && (
              <div className="mt-2 font-mono text-[10px] text-huma-t3">
                큐 ID {job.id.slice(0, 8)}… · {WS_LABEL[ws] ?? ws} · {job.status}
                {dryRun ? ' · dry_run' : ''}
              </div>
            )}
          </div>
        )}

        {!readyForTyping && (
          <>
            <h1 className="mb-2 text-lg font-semibold text-[#333]">{job?.title ?? '콘텐츠 생성 중…'}</h1>
            {job?.link_url && (
              <a
                href={job.link_url}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-huma-acc hover:underline"
              >
                {job.link_url}
              </a>
            )}

            <div className="m-panel mt-4">
              <div className="panel-title mb-3">생성 단계</div>
              <ul className="space-y-2">
                {steps.map((step) => (
                  <li key={step.id} className="flex items-start gap-2 text-[13px]">
                    <StepIcon status={step.status} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{step.label}</div>
                      {step.id === 'imagen' && step.status === 'ok' && displayImageUrl ? (
                        <div className="mt-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={displayImageUrl}
                            alt="Imagen 4 생성"
                            className="max-h-[200px] rounded-md border border-huma-bdr object-contain"
                          />
                        </div>
                      ) : step.detail && !(step.id === 'imagen' && step.status === 'ok' && step.detail.startsWith('http')) ? (
                        <div className="mt-0.5 break-all font-mono text-[10px] text-huma-t3">{step.detail}</div>
                      ) : null}
                      {step.ms != null && step.status === 'ok' && (
                        <div className="text-[10px] text-huma-t3">{(step.ms / 1000).toFixed(1)}초</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {displayImageUrl && !readyForTyping && (
              <div className="m-panel mt-4">
                <div className="panel-title mb-2">Imagen 4 생성 이미지</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayImageUrl}
                  alt="Imagen 4"
                  className="mx-auto max-h-[320px] rounded-md object-contain"
                />
                <p className="mt-2 text-center text-[11px] text-huma-t3">타이핑 시뮬 시작 대기 중…</p>
              </div>
            )}
          </>
        )}

        {(error || imagenError) && (
          <div className="mt-4 rounded-md border border-huma-err/50 bg-huma-err/10 px-3 py-2 text-sm text-huma-err">
            {imagenError ?? error}
            {imagenError && (
              <p className="mt-2 text-[11px] opacity-90">
                i7 서버의 GOOGLE_AI_API_KEY · Imagen API 활성화 · huma-media Storage 버킷을 확인하세요.
              </p>
            )}
          </div>
        )}

        {readyForTyping && job?.title && job.content && displayImageUrl && (
          <div className="flex min-h-0 flex-1 flex-col">
            <PlaywrightPostingReplay
              key={simulatorKey}
              title={job.title}
              body={prepareBodyForTypingSim(job.content, {
                contentType,
                linkUrl: normalizeBlogLink(job.link_url),
              })}
              linkUrl={normalizeBlogLink(job.link_url)}
              imageUrl={displayImageUrl}
              contentType={contentType}
            />
          </div>
        )}

        {(job?.status === 'running' || waitingForImagen || (jobDone && imagenDone && previewImageUrl && !displayImageUrl && !imagenError)) && (
          <p className="mt-6 text-center text-[12px] text-huma-t3">
            {waitingForImagen
              ? 'Claude 완료 · Imagen 4 생성 중…'
              : jobDone && imagenDone && !displayImageUrl
                ? 'Imagen 이미지 불러오는 중…'
                : '워커가 Claude → Imagen 순으로 처리 중… (1~2분)'}
          </p>
        )}
      </div>
    </div>
  );
}
