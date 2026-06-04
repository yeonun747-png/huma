'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HumaVideoQueue } from '@huma/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import {
  DEFAULT_VIDEO_MODEL,
  IMAGEN_PIPELINE_OPTIONS,
  PIPELINE_VIDEO_OPTIONS,
  type ImagenPipelineChoice,
  estimateTodayPipelineCost,
  normalizeImagenPipelineChoice,
  normalizePipelineVideoSelect,
  pipelineImageCost,
  pipelineTotalCostDisplay,
  pipelineVideoCost,
  pipelineVideoFromSelect,
  tableImageModelLabel,
} from '@/lib/higgsfield-models';
import { MGrid, MPanel, MStat, MTable, MTag } from '@/components/mockup/primitives';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const PIPE_STEPS = [
  { key: 'image_generating', titleDone: '이미지 생성 완료', titleActive: 'Imagen 4 이미지 생성 중…', titleIdle: 'Imagen 4 이미지' },
  { key: 'video_generating', titleDone: '영상 생성 완료', titleActive: '영상 생성 중…', titleIdle: 'Kling 3.0 영상 (내장 오디오)' },
  { key: 'finalizing', titleDone: 'ffmpeg 처리 완료', titleActive: 'ffmpeg 처리 중…', titleIdle: 'ffmpeg 처리' },
  { key: 'uploading', titleDone: '플랫폼 업로드 완료', titleActive: '플랫폼 업로드 중…', titleIdle: '플랫폼 업로드' },
] as const;

function normalizeDisplayStep(step?: string | null): string {
  if (step === 'tts_generating' || step === 'lipsync_generating') return 'video_generating';
  if (step === 'pending') return 'image_generating';
  if (step && PIPE_STEPS.some((s) => s.key === step)) return step;
  return 'image_generating';
}

function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function rowCost(v: HumaVideoQueue, imgChoice: ImagenPipelineChoice): string {
  if (v.status === 'done') {
    const img = pipelineImageCost(normalizeImagenPipelineChoice(v.image_model) ?? imgChoice);
    const vid = pipelineVideoCost(v.video_model ?? DEFAULT_VIDEO_MODEL);
    return `$${(img.minUsd + vid.usd).toFixed(2)}`;
  }
  if (v.status === 'failed') return '—';
  return '진행중';
}

function uploadTags(v: HumaVideoQueue) {
  if (v.status !== 'done') return <MTag tone="idle">대기</MTag>;
  const parts: ReactNode[] = [];
  if (v.tiktok_result_url) parts.push(<MTag key="tt" tone="ok">TikTok ✓</MTag>);
  if (v.instagram_result_url) parts.push(<MTag key="ig" tone="ok">IG ✓</MTag>);
  if (v.youtube_result_url) parts.push(<MTag key="yt" tone="ok">YT ✓</MTag>);
  if (!parts.length) return <MTag tone="ok">완료</MTag>;
  return <span className="inline-flex flex-wrap gap-1">{parts}</span>;
}

export function VideoPipelineView() {
  const { workspace } = useWorkspace();
  const [items, setItems] = useState<HumaVideoQueue[]>([]);
  const [imgChoice, setImgChoice] = useState<ImagenPipelineChoice>('auto');
  const [haikuAuto, setHaikuAuto] = useState(true);
  const [vidSelect, setVidSelect] = useState('kling-3.0');
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    Promise.all([api.videoQueue(), api.getSetting('higgsfield').catch(() => ({}))])
      .then(([all, hg]) => {
        const wsItems = all.filter((v) => v.workspace === workspace);
        setItems(wsItems);
        const settings = hg as Record<string, unknown>;
        setVidSelect(normalizePipelineVideoSelect(String(settings.default_video_model ?? DEFAULT_VIDEO_MODEL)));
      })
      .catch(() => setItems([]));
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  const wsItems = items;
  const todayItems = wsItems.filter((v) => isToday(v.created_at));
  const running = wsItems.find((v) => v.status !== 'done' && v.status !== 'failed');
  const runningCount = wsItems.filter((v) => v.status !== 'done' && v.status !== 'failed').length;
  const doneToday = todayItems.filter((v) => v.status === 'done');
  const costEst = estimateTodayPipelineCost(todayItems);
  const displayStep = normalizeDisplayStep(running?.current_step ?? running?.status);
  const stepIndex = PIPE_STEPS.findIndex((s) => s.key === displayStep);

  const imgCost = pipelineImageCost(imgChoice);
  const vidCost = pipelineVideoCost(vidSelect);
  const totalCost = pipelineTotalCostDisplay(imgChoice, vidSelect);

  const uploadSub = useMemo(() => {
    const tt = doneToday.filter((v) => v.tiktok_result_url).length;
    const ig = doneToday.filter((v) => v.instagram_result_url).length;
    const yt = doneToday.filter((v) => v.youtube_result_url).length;
    const parts = [
      tt ? `TikTok ${tt}` : '',
      ig ? `IG ${ig}` : '',
      yt ? `YT ${yt}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join('·') : 'TikTok·IG·YouTube';
  }, [doneToday]);

  const startPipeline = async () => {
    const resolvedImg = haikuAuto && imgChoice === 'auto' ? undefined : imgChoice === 'auto' ? undefined : imgChoice;
    await api.createVideo({
      workspace,
      image_prompt: 'cinematic character portrait, 9:16',
      video_prompt: 'slow camera zoom, emotional scene',
      ...(resolvedImg ? { image_model: resolvedImg } : {}),
      video_model: pipelineVideoFromSelect(vidSelect),
      upload_platforms: ['tiktok', 'instagram', 'youtube'],
    });
    load();
  };

  useRegisterPageAction('startVideoPipeline', startPipeline);

  const pipeStepSub = (key: string) => {
    if (!running) return key === 'uploading' ? 'TikTok · Instagram Reels · YouTube Shorts (API 동시 발행)' : '대기 중';
    if (key === 'image_generating') {
      return `${running.image_prompt?.slice(0, 28) ?? workspace} — Imagen 4 · ${imgCost.display}`;
    }
    if (key === 'video_generating') {
      return `${pipelineVideoFromSelect(vidSelect)} · ${vidCost.durationLabel} · $${vidCost.usd.toFixed(2)} · 내장 오디오 포함`;
    }
    if (key === 'finalizing') return '이미지 고유화(노이즈·EXIF) + 영상 포맷 변환 (9:16 720p)';
    return 'TikTok · Instagram Reels · YouTube Shorts (API 동시 발행)';
  };

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MStat label="오늘 생성" value={todayItems.length} sub="9:16 완료" />
        <MStat label="진행중" value={runningCount} tone="warn" sub="파이프라인 중" />
        <MStat label="업로드 완료" value={doneToday.length} tone="ok" sub={uploadSub} />
        <MStat label="오늘 API 비용" value={costEst.totalDisplay} sub={costEst.subDisplay} tone="ok" />
      </MGrid>

      <MGrid cols={2}>
        <MPanel title="새 영상 생성 요청">
          <div ref={formRef} className="flex flex-col gap-2.5">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="font-mono text-[11px] tracking-wide text-huma-t3">
                  ① 이미지 모델{' '}
                  <span className="text-[#4285f4]">Google Imagen 4</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-huma-t3">
                  Haiku 자동 판단
                  <button
                    type="button"
                    className={cn('m-tgl m-tgl-sm', haikuAuto && 'on')}
                    aria-pressed={haikuAuto}
                    onClick={() => {
                      setHaikuAuto((v) => {
                        const next = !v;
                        if (next) setImgChoice('auto');
                        return next;
                      });
                    }}
                  />
                </div>
              </div>
              <select
                className="m-model-select"
                value={imgChoice}
                disabled={haikuAuto}
                onChange={(e) => setImgChoice(normalizeImagenPipelineChoice(e.target.value))}
              >
                {IMAGEN_PIPELINE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {haikuAuto && (
                <div className="mt-1 rounded bg-huma-bg3 px-2 py-1 font-mono text-[10.5px] text-huma-t3">
                  💡 Haiku가 프롬프트 분석 → 텍스트 포함 시 Standard, 일반 시 Fast 자동 선택
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 font-mono text-[11px] tracking-wide text-huma-t3">
                ② 영상 모델 <span className="text-huma-acc">Higgsfield Cloud API</span>
              </div>
              <select className="m-model-select" value={vidSelect} onChange={(e) => setVidSelect(e.target.value)}>
                {PIPELINE_VIDEO_OPTIONS.map((m) => (
                  <option key={m.selectValue} value={m.selectValue}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="mt-1 rounded px-2 py-1 font-mono text-[10px] text-huma-ok bg-[var(--ok-bg)]">
                ✓ TTS 불필요 — Kling 3.0 내장 오디오(BGM·효과음) 자동 생성
              </div>
            </div>

            <div>
              <div className="mb-1 font-mono text-[11px] tracking-wide text-huma-t3">③ 오디오</div>
              <div className="flex items-center gap-2.5 rounded-md border border-[rgba(78,203,113,0.25)] bg-[var(--ok-bg)] px-2.5 py-2">
                <div className="text-[17px]">🎵</div>
                <div>
                  <div className="text-[13px] font-semibold text-huma-ok">Kling 3.0 내장 오디오 자동 생성</div>
                  <div className="font-mono text-[11px] text-huma-t3">
                    BGM · 효과음 · 주변음 — 영상과 동기화, 별도 설정 불필요
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-huma-bdr bg-huma-bg3 px-2.5 py-2">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-huma-t3">예상 비용 (건당)</div>
              <div className="flex justify-between text-[11.5px] text-huma-t3">
                <span>
                  이미지 <span className="text-huma-t2">{imgCost.label}</span>
                </span>
                <span className="font-mono text-huma-t">{imgCost.display}</span>
              </div>
              <div className="mt-0.5 flex justify-between text-[11.5px] text-huma-t3">
                <span>영상 {pipelineVideoFromSelect(vidSelect)} {vidCost.durationLabel}</span>
                <span className="font-mono text-huma-t">${vidCost.usd.toFixed(2)}</span>
              </div>
              <div className="mt-1.5 flex justify-between border-t border-huma-bdr2 pt-1.5">
                <span className="text-[12px] font-bold text-huma-t2">합계 (영상 포함)</span>
                <span className="font-mono text-[13.5px] font-bold text-huma-acc">~{totalCost}</span>
              </div>
            </div>

            <button type="button" className="btn-primary w-full py-2.5" onClick={startPipeline}>
              ▶ 파이프라인 시작
            </button>
          </div>
        </MPanel>

        <MPanel title="진행 중인 파이프라인">
          {PIPE_STEPS.map((step, i) => {
            const active = displayStep === step.key;
            const done = running ? stepIndex > i : false;
            const idle = !running || stepIndex < i;
            const badge =
              step.key === 'image_generating' && (done || active) ? (
                <span className="m-model-badge m-badge-google">Google</span>
              ) : active ? (
                <span className="m-model-badge m-badge-warn">진행중</span>
              ) : done ? (
                <span className="m-model-badge m-badge-ok">완료</span>
              ) : (
                <span className="m-model-badge m-badge-idle">대기</span>
              );

            const title = done ? step.titleDone : active ? step.titleActive : step.titleIdle;

            return (
              <div key={step.key} className={cn('m-pipe-step', idle && running && 'opacity-50')}>
                <div className={cn('m-pipe-step-num', done ? 'done' : active ? 'running' : 'idle')}>{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="m-pipe-step-title">
                    {title}
                    {active && step.key === 'video_generating' && (
                      <span className="ml-1 font-mono text-[11px] text-huma-warn">~45초 소요</span>
                    )}
                  </div>
                  <div className="m-pipe-step-sub">{pipeStepSub(step.key)}</div>
                </div>
                {badge}
              </div>
            );
          })}
        </MPanel>
      </MGrid>

      <MPanel title="오늘 완료된 영상">
        {todayItems.length === 0 ? (
          <EmptyPanel message="오늘 영상 파이프라인 작업이 없습니다" />
        ) : (
          <MTable
            head={['영상', '이미지', '영상', '오디오', 'BGM', '비용', '업로드']}
            rows={todayItems.slice(0, 10).map((v) => [
              v.image_prompt?.slice(0, 24) ?? v.id.slice(0, 8),
              <span key="i" className="font-mono text-[11px] text-[#4285f4]">
                {tableImageModelLabel(v.image_model)}
              </span>,
              <span key="v" className="font-mono text-[11px]">
                {(v.video_model ?? DEFAULT_VIDEO_MODEL).replace('veo-3.1-lite', 'veo-3.1-fast')} 15s
              </span>,
              <MTag key="a" tone="ok">
                {v.tts_script?.trim() ? 'TTS' : '내장'}
              </MTag>,
              <span key="b" className="text-[11px] text-huma-t3">
                {v.tts_script?.trim() ? '—' : '자동'}
              </span>,
              <span key="c" className={cn('font-mono text-[11px]', v.status === 'done' && 'text-huma-ok')}>
                {rowCost(v, imgChoice)}
              </span>,
              uploadTags(v),
            ])}
          />
        )}
      </MPanel>
    </div>
  );
}
