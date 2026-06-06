'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';

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

function TypingSimulator({ title, body }: { title: string; body: string }) {
  const full = `${title}\n\n${body}`;
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setShown('');
    setDone(false);
    let i = 0;
    const id = window.setInterval(() => {
      i += Math.random() < 0.28 ? 12 : 2;
      if (i >= full.length) {
        setShown(full);
        setDone(true);
        window.clearInterval(id);
        return;
      }
      setShown(full.slice(0, i));
    }, 45);
    return () => window.clearInterval(id);
  }, [full]);

  return (
    <div className="mt-4 rounded-lg border border-huma-bdr bg-[#fafafa] text-[#111]">
      <div className="border-b border-[#e5e5e5] px-4 py-2 text-[11px] text-[#888]">
        네이버 블로그 에디터 (시뮬레이션 · 실제 발행 없음)
        {done ? ' · 타이핑 완료' : ' · 타이핑 중…'}
      </div>
      <div className="min-h-[280px] whitespace-pre-wrap px-4 py-3 font-[Malgun_Gothic,sans-serif] text-[14px] leading-relaxed">
        {shown}
        {!done && <span className="inline-block w-0.5 animate-pulse bg-[#03c75a]">|</span>}
      </div>
    </div>
  );
}

export function PostingPreviewClient({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<HumaJob | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const row = await api.getJob(jobId);
        if (cancelled) return;
        setJob(row);
        if (row.status === 'failed') {
          setError(row.error_message ?? '작업 실패');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '조회 실패');
      }
    };
    void poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId]);

  const steps = useMemo(() => stepsFromJob(job), [job]);
  const ws = (job?.workspace ?? 'yeonun') as keyof typeof WS_LABEL;
  const imageUrl = job?.image_urls?.[0]?.startsWith('http') ? job.image_urls[0] : null;
  const ready = job?.status === 'completed' && Boolean(job.content && job.content.length > 100);
  const dryRun = (job?.platform_schedule as Record<string, unknown> | undefined)?._dry_run === true;

  return (
    <div className="min-h-screen bg-huma-bg2 px-4 py-6 text-huma-t">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 rounded-lg border border-huma-acc/40 bg-huma-glow px-4 py-3">
          <div className="text-sm font-semibold text-huma-acc">🔍 포스팅 검증 모드</div>
          <div className="mt-1 text-[12px] text-huma-t2">
            Claude · Imagen 4 생성 확인 후 타이핑만 시뮬레이션합니다.{' '}
            <strong className="text-huma-warn">네이버 블로그에 실제 발행하지 않습니다.</strong>
          </div>
          {job && (
            <div className="mt-2 font-mono text-[10px] text-huma-t3">
              큐 ID {job.id.slice(0, 8)}… · {WS_LABEL[ws] ?? ws} · {job.status}
              {dryRun ? ' · dry_run' : ''}
            </div>
          )}
        </div>

        <h1 className="mb-2 text-lg font-semibold">{job?.title ?? '콘텐츠 생성 중…'}</h1>
        {job?.link_url && (
          <a href={job.link_url} target="_blank" rel="noreferrer" className="text-[12px] text-huma-acc hover:underline">
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
                  {step.detail && (
                    <div className="mt-0.5 break-all font-mono text-[10px] text-huma-t3">{step.detail}</div>
                  )}
                  {step.ms != null && step.status === 'ok' && (
                    <div className="text-[10px] text-huma-t3">{(step.ms / 1000).toFixed(1)}초</div>
                  )}
                </div>
              </li>
            ))}
            {ready && (
              <li className="flex items-start gap-2 text-[13px]">
                <StepIcon status="running" />
                <div>네이버 타이핑 시뮬 (복붙 30% / 타이핑 70% 대신 가상 타이핑)</div>
              </li>
            )}
          </ul>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-huma-err/50 bg-huma-err/10 px-3 py-2 text-sm text-huma-err">
            {error}
          </div>
        )}

        {imageUrl && (
          <div className="m-panel mt-4">
            <div className="panel-title mb-2">Imagen 4 생성 이미지</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Imagen 생성" className="mx-auto max-h-[420px] rounded-md object-contain" />
          </div>
        )}

        {ready && job?.title && job.content && (
          <div className="m-panel mt-4">
            <div className="panel-title mb-2">Claude Sonnet 본문 + 타이핑 시뮬</div>
            <TypingSimulator title={job.title} body={job.content} />
          </div>
        )}

        {job?.status === 'running' && (
          <p className="mt-6 text-center text-[12px] text-huma-t3">워커가 Claude → Imagen 순으로 처리 중… (1~2분)</p>
        )}
      </div>
    </div>
  );
}
