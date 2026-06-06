'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HumaVideoQueue } from '@huma/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import {
  DEFAULT_VIDEO_MODEL,
  IMAGEN_PIPELINE_OPTIONS,
  PIPELINE_VIDEO_HINT,
  PIPELINE_VIDEO_OPTIONS,
  type ImagenPipelineChoice,
  estimateTodayPipelineCost,
  getPipelineAudioCopy,
  getPipelineVideoOption,
  getPipelineImageStepTitles,
  getPipelineVideoStepTitles,
  normalizeImagenPipelineChoice,
  resolvePipelineImageChoice,
  normalizePipelineVideoSelect,
  pipelineImageCost,
  pipelineTotalCostDisplay,
  pipelineVideoCost,
  pipelineVideoFromSelect,
  tableImageModelLabel,
} from '@/lib/higgsfield-models';
import { MGrid, MPanel, MStat, MTable, MTag } from '@/components/mockup/primitives';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { PostViewerModal } from '@/components/viewer/post-viewer-modal';

const PIPE_STEPS = [
  { key: 'image_generating' },
  { key: 'video_generating' },
  { key: 'finalizing' },
  { key: 'uploading' },
] as const;

const PREVIEW_TABS = ['text', 'image', 'video'] as const;
type PreviewTab = (typeof PREVIEW_TABS)[number] | 'post';

const IS_DEV = process.env.NODE_ENV === 'development';
const SIMUL_STEP_MS = [3000, 8000, 2000, 2500] as const;
const SIMUL_TITLES: Record<string, string> = {
  yeonun: '연운 · 신년운세 쇼츠 — TikTok',
  quizoasis: '퀴즈오아시스 · MBTI 결과 릴스',
  panana: '파나나 · 철학 대화 영상 — TikTok',
};

function normalizeDisplayStep(step?: string | null): string {
  if (step === 'tts_generating' || step === 'lipsync_generating') return 'video_generating';
  if (step === 'pending') return 'image_generating';
  if (step && PIPE_STEPS.some((s) => s.key === step)) return step;
  return 'image_generating';
}

import { isSameKstDay } from '@/lib/format-kst';

function rowCost(v: HumaVideoQueue, imgChoice: ImagenPipelineChoice): string {
  if (v.status === 'done') {
    const img = pipelineImageCost(normalizeImagenPipelineChoice(v.image_model) ?? imgChoice);
    const vid = pipelineVideoCost(v.video_model ?? DEFAULT_VIDEO_MODEL);
    return `$${(img.minUsd + vid.usd).toFixed(2)}`;
  }
  if (v.status === 'failed') return '—';
  return '진행중';
}

function audioTag(v: HumaVideoQueue): string {
  if (v.tts_script?.trim()) return 'TTS';
  return (v.video_model ?? '').includes('seedance') ? 'Seedance 2.0' : 'Kling 3.0';
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
  const [previewTab, setPreviewTab] = useState<PreviewTab>('text');
  const [viewer, setViewer] = useState<{
    title: string;
    isLive?: boolean;
    content?: string | null;
    imageUrl?: string | null;
    videoUrl?: string | null;
    resultUrl?: string | null;
    completedAt?: string | null;
  } | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [simul, setSimul] = useState<{ step: number; title: string } | null>(null);
  const [simulDone, setSimulDone] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.videoQueue(), api.getSetting('higgsfield').catch(() => ({}))])
      .then(([all, hg]) => {
        const wsItems = all.filter((v) => v.workspace === workspace);
        setItems(wsItems);
        const settings = hg as Record<string, unknown>;
        const savedVid = normalizePipelineVideoSelect(String(settings.default_video_model ?? DEFAULT_VIDEO_MODEL));
        setVidSelect(savedVid);
        const savedImg = String(settings.default_image_model ?? 'auto');
        if (savedImg === 'auto' || !savedImg.startsWith('imagen-')) {
          setHaikuAuto(true);
          setImgChoice('auto');
        } else {
          setHaikuAuto(false);
          setImgChoice(normalizeImagenPipelineChoice(savedImg));
        }
        setSettingsLoaded(true);
      })
      .catch(() => setItems([]));
  }, [workspace]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const saveModelSettings = useCallback(
    async (next: { img: ImagenPipelineChoice; haiku: boolean; vid: string }) => {
      const hg = (await api.getSetting('higgsfield').catch(() => ({}))) as Record<string, unknown>;
      const imageModel = next.haiku || next.img === 'auto' ? 'auto' : next.img;
      await api.updateSetting('higgsfield', {
        ...hg,
        default_image_model: imageModel,
        default_video_model: pipelineVideoFromSelect(next.vid),
        video_duration_sec: 15,
      });
    },
    [],
  );

  useEffect(() => {
    if (!simul) return;
    if (simul.step >= PIPE_STEPS.length) {
      setSimulDone(simul.title);
      setSimul(null);
      return;
    }
    const t = setTimeout(() => {
      setSimul((s) => (s ? { ...s, step: s.step + 1 } : null));
    }, SIMUL_STEP_MS[simul.step]);
    return () => clearTimeout(t);
  }, [simul]);

  const wsItems = items;
  const todayItems = wsItems.filter((v) => isSameKstDay(v.created_at));
  const running = wsItems.find((v) => v.status !== 'done' && v.status !== 'failed');

  const startSimul = () => {
    if (running || simul) return;
    const title = SIMUL_TITLES[workspace] ?? `${workspace} · 콘텐츠 미리보기`;
    setSimulDone(null);
    setSimul({ step: 0, title });
  };
  const simulActive = Boolean(simul && simul.step < PIPE_STEPS.length);
  const runningCount =
    wsItems.filter((v) => v.status !== 'done' && v.status !== 'failed').length + (simulActive ? 1 : 0);
  const doneToday = todayItems.filter((v) => v.status === 'done');
  const costEst = estimateTodayPipelineCost(todayItems);
  const displayStep = simulActive
    ? PIPE_STEPS[simul!.step].key
    : running
      ? normalizeDisplayStep(running.current_step ?? running.status)
      : null;
  const stepIndex = displayStep ? PIPE_STEPS.findIndex((s) => s.key === displayStep) : -1;
  const simulPrompt = simul?.title ?? simulDone;

  const imgCost = pipelineImageCost(imgChoice);
  const vidCost = pipelineVideoCost(vidSelect);
  const audioCopy = getPipelineAudioCopy(vidSelect);
  const totalCost = pipelineTotalCostDisplay(imgChoice, vidSelect);

  const pipelineImgChoice = resolvePipelineImageChoice(imgChoice, haikuAuto, running?.image_model);
  const pipelineImageTitles = getPipelineImageStepTitles(pipelineImgChoice);
  const pipelineImgCost = pipelineImageTitles.cost;

  const pipelineVidSelect = running
    ? normalizePipelineVideoSelect(running.video_model ?? vidSelect)
    : vidSelect;
  const pipelineVidCost = pipelineVideoCost(pipelineVidSelect);
  const pipelineVidOption = getPipelineVideoOption(pipelineVidSelect);
  const pipelineAudioCopy = getPipelineAudioCopy(pipelineVidSelect);
  const pipelineVideoTitles = getPipelineVideoStepTitles(pipelineVidSelect);

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

  const lastDone = doneToday[0];

  const pipeStepSub = (key: string) => {
    if (!running && !simulActive) return '';
    const prompt = simulActive ? simul!.title.slice(0, 28) : running?.image_prompt?.slice(0, 28) ?? workspace;
    if (key === 'image_generating') {
      return `${prompt} — ${pipelineImgCost.label} · ${pipelineImgCost.display}`;
    }
    if (key === 'video_generating') {
      return `${pipelineVidOption.displayName} · ${pipelineVidCost.durationLabel} · ${pipelineVidOption.credits}크레딧 · $${pipelineVidCost.usd.toFixed(2)} · ${pipelineAudioCopy.runningLabel} 포함`;
    }
    if (key === 'finalizing') return '픽셀노이즈+EXIF · 9:16 720p';
    return 'TikTok · Instagram Reels · YouTube Shorts (API 동시 발행)';
  };

  const stepTitle = (key: string, i: number) => {
    const active = Boolean((running || simulActive) && displayStep === key);
    const done = running || simulActive ? stepIndex > i : false;
    if (key === 'image_generating') {
      return done ? pipelineImageTitles.titleDone : active ? pipelineImageTitles.titleActive : pipelineImageTitles.titleIdle;
    }
    if (key === 'video_generating') {
      return done ? pipelineVideoTitles.titleDone : active ? pipelineVideoTitles.titleActive : pipelineVideoTitles.titleIdle;
    }
    if (key === 'finalizing') {
      return done ? 'ffmpeg 처리 완료' : active ? 'ffmpeg 처리 중…' : 'ffmpeg 처리';
    }
    return done ? '플랫폼 업로드 완료' : active ? '플랫폼 업로드 중…' : '플랫폼 업로드';
  };

  return (
    <div className="animate-fadeIn">
      <PostViewerModal
        open={Boolean(viewer)}
        title={viewer?.title ?? ''}
        workspace={workspace}
        isLive={viewer?.isLive}
        content={viewer?.content}
        imageUrl={viewer?.imageUrl}
        videoUrl={viewer?.videoUrl}
        resultUrl={viewer?.resultUrl}
        completedAt={viewer?.completedAt}
        onClose={() => setViewer(null)}
      />

      <MGrid cols={4}>
        <MStat label="오늘 생성" value={todayItems.length} sub="9:16 완료" />
        <MStat label="진행중" value={runningCount} tone="warn" sub="파이프라인 중" />
        <MStat label="업로드 완료" value={doneToday.length} tone="ok" sub={uploadSub} />
        <MStat label="오늘 API 비용" value={costEst.totalDisplay} sub={costEst.subDisplay} tone="ok" />
      </MGrid>

      <MGrid cols={2}>
        <MPanel
          title={
            <>
              🎛 모델 설정{' '}
              <span className="ml-1 font-mono text-[9.5px] font-normal text-huma-ok">전체 작업 자동 적용</span>
            </>
          }
        >
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="font-mono text-[11px] tracking-wide text-huma-t3">
                  ① 이미지 모델 <span className="text-[#4285f4]">Google Imagen 4</span>
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
                        const img = next ? 'auto' : imgChoice;
                        if (next) setImgChoice('auto');
                        if (settingsLoaded) void saveModelSettings({ img, haiku: next, vid: vidSelect });
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
                onChange={(e) => {
                  const img = normalizeImagenPipelineChoice(e.target.value);
                  setImgChoice(img);
                  if (settingsLoaded) void saveModelSettings({ img, haiku: haikuAuto, vid: vidSelect });
                }}
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
              <select
                className="m-model-select"
                value={vidSelect}
                onChange={(e) => {
                  const vid = e.target.value;
                  setVidSelect(vid);
                  if (settingsLoaded) void saveModelSettings({ img: imgChoice, haiku: haikuAuto, vid });
                }}
              >
                {PIPELINE_VIDEO_OPTIONS.map((m) => (
                  <option key={m.selectValue} value={m.selectValue}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="mt-1 rounded bg-[var(--ok-bg)] px-2 py-1 font-mono text-[10px] text-huma-ok">
                {PIPELINE_VIDEO_HINT}
              </div>
            </div>

            <div>
              <div className="mb-1 font-mono text-[11px] tracking-wide text-huma-t3">③ 오디오</div>
              <div className="flex items-center gap-2.5 rounded-md border border-[rgba(78,203,113,0.25)] bg-[var(--ok-bg)] px-2.5 py-2">
                <div className="text-[17px]">{audioCopy.emoji}</div>
                <div>
                  <div className="text-[13px] font-semibold text-huma-ok">{audioCopy.title}</div>
                  <div className="font-mono text-[11px] text-huma-t3">{audioCopy.sub}</div>
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
                <span>
                  영상 {getPipelineVideoOption(vidSelect).displayName} {vidCost.durationLabel}
                </span>
                <span className="font-mono text-huma-t">${vidCost.usd.toFixed(2)}</span>
              </div>
              <div className="mt-1.5 flex justify-between border-t border-huma-bdr2 pt-1.5">
                <span className="text-[12px] font-bold text-huma-t2">합계 (영상 포함)</span>
                <span className="font-mono text-[13.5px] font-bold text-huma-acc">~{totalCost}</span>
              </div>
            </div>
          </div>
        </MPanel>

        <MPanel
          title={simulActive ? '실행 중인 파이프라인' : '진행 중인 파이프라인'}
          action={
            <span className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-huma-t4">큐 스케줄 자동 실행</span>
              {IS_DEV && (
                <button
                  type="button"
                  className="rounded border border-huma-t4 bg-transparent px-1.5 py-0.5 font-mono text-[9.5px] text-huma-t4 hover:border-huma-acc hover:text-huma-acc"
                  title="목업 시뮬레이션 전용"
                  onClick={startSimul}
                  disabled={Boolean(running || simul)}
                >
                  ▷ 시뮬
                </button>
              )}
            </span>
          }
        >
          {!running && !simulActive ? (
            <div className="py-7 text-center">
              <div className="mb-2 text-[28px] opacity-20">▷</div>
              <div className="mb-1 text-[13px] font-semibold text-huma-t2">대기 중</div>
              <div className="font-mono text-[11px] leading-relaxed text-huma-t3">
                큐에 🎬 영상 작업이 등록되면
                <br />
                스케줄에 따라 자동 시작됩니다
              </div>
            </div>
          ) : (
            PIPE_STEPS.map((step, i) => {
              const active = displayStep === step.key;
              const done = stepIndex > i;
              const idle = stepIndex < i;
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

              return (
                <div key={step.key} className={cn('m-pipe-step', idle && 'opacity-50')}>
                  <div className={cn('m-pipe-step-num', done ? 'done' : active ? 'running' : 'idle')}>{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="m-pipe-step-title">
                      {stepTitle(step.key, i)}
                      {active && step.key === 'image_generating' && (
                        <span className="ml-1 font-mono text-[11px] text-huma-warn">~12초 소요</span>
                      )}
                      {active && step.key === 'video_generating' && (
                        <span className="ml-1 font-mono text-[11px] text-huma-warn">~45초 소요</span>
                      )}
                    </div>
                    <div className="m-pipe-step-sub">{pipeStepSub(step.key)}</div>
                  </div>
                  {badge}
                </div>
              );
            })
          )}
          {simulDone && !running && !simulActive && (
            <div className="mt-2 rounded-md bg-[var(--ok-bg)] px-2.5 py-1.5 text-center font-mono text-[11.5px] text-huma-ok">
              ✅ 완료 · {simulDone}
            </div>
          )}
          {lastDone && !running && !simulActive && !simulDone && (
            <div className="mt-2 rounded-md bg-[var(--ok-bg)] px-2.5 py-1.5 text-center font-mono text-[11.5px] text-huma-ok">
              ✅ 최근 완료 · {lastDone.image_prompt?.slice(0, 24) ?? lastDone.id.slice(0, 8)}
            </div>
          )}
        </MPanel>
      </MGrid>

      <MPanel
        title={
          <div className="flex flex-wrap items-center gap-2">
            <span>콘텐츠 조감</span>
            <div className="inline-flex gap-0.5">
              {(['text', 'image', 'video'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={cn('m-prev-tab', previewTab === tab && 'on')}
                  onClick={() => setPreviewTab(tab)}
                >
                  {tab === 'text' ? '텍스트' : tab === 'image' ? '이미지' : '영상'}
                </button>
              ))}
              <button
                type="button"
                className="m-prev-tab on bg-[var(--glow)] text-huma-acc"
                onClick={() =>
                  setViewer({
                    title: (simulPrompt ?? running?.image_prompt)?.slice(0, 40) ?? '콘텐츠 미리보기',
                    isLive: Boolean(running || simulActive),
                    content: running?.caption ?? running?.image_prompt ?? simulPrompt,
                    imageUrl: running?.generated_image_url ?? null,
                    videoUrl: running?.source_video_url ?? null,
                  })
                }
              >
                포스팅 전체조감 ↗
              </button>
            </div>
          </div>
        }
      >
        <div className="m-preview-frame min-h-[220px]">
          {previewTab === 'text' && (
            <EmptyPanel
              message={
                simulPrompt
                  ? simulPrompt.slice(0, 120)
                  : running?.image_prompt
                    ? running.image_prompt.slice(0, 120)
                    : '파이프라인 실행 후 생성된 텍스트 표시'
              }
            />
          )}
          {previewTab === 'image' && (
            <EmptyPanel
              message={
                running?.generated_image_url
                  ? '이미지 생성 완료 — URL 저장됨'
                  : '이미지 생성(Step 1) 완료 후 표시'
              }
            />
          )}
          {previewTab === 'video' && (
            <EmptyPanel
              message={
                running?.source_video_url ? '영상 생성 완료' : '영상 생성(Step 2) 완료 후 플레이어 활성화'
              }
            />
          )}
        </div>
      </MPanel>

      <MPanel title="오늘 완료된 영상">
        {todayItems.length === 0 ? (
          <EmptyPanel message="오늘 영상 파이프라인 작업이 없습니다" />
        ) : (
          <MTable
            head={['영상', '이미지 모델', '영상 모델', '오디오', '비용', '업로드', '전체조감']}
            rows={todayItems.slice(0, 10).map((v) => {
              const label = v.image_prompt?.slice(0, 24) ?? v.id.slice(0, 8);
              return [
                label,
                <span key="i" className="font-mono text-[11px] text-[#4285f4]">
                  {tableImageModelLabel(v.image_model)}
                </span>,
                <span key="v" className="font-mono text-[11px]">
                  {pipelineVideoFromSelect(normalizePipelineVideoSelect(v.video_model ?? vidSelect))}{' '}
                  {pipelineVideoCost(v.video_model ?? vidSelect).durationLabel}
                </span>,
                <MTag key="a" tone="ok">
                  {audioTag(v)}
                </MTag>,
                <span key="c" className={cn('font-mono text-[11px]', v.status === 'done' && 'text-huma-ok')}>
                  {rowCost(v, imgChoice)}
                </span>,
                uploadTags(v),
                <button
                  key="pv"
                  type="button"
                  className="rounded border border-huma-bdr bg-transparent px-1.5 py-0.5 font-mono text-[10.5px] text-huma-acc hover:border-huma-acc"
                  onClick={() =>
                    setViewer({
                      title: label,
                      content: v.caption ?? v.image_prompt,
                      imageUrl: v.generated_image_url ?? null,
                      videoUrl: v.source_video_url ?? v.output_video_path ?? null,
                      resultUrl: v.tiktok_result_url ?? v.instagram_result_url ?? v.youtube_result_url ?? null,
                      completedAt: v.updated_at ?? v.created_at,
                    })
                  }
                >
                  🔍 조감
                </button>,
              ];
            })}
          />
        )}
      </MPanel>

      <p className="mt-2 text-center font-mono text-[10.5px] text-huma-t3">
        Type B 콘텐츠는{' '}
        <Link href="/queue" className="text-huma-acc hover:underline">
          큐 관리 → 작업 추가
        </Link>
        로 등록하면 스케줄에 따라 파이프라인이 자동 실행됩니다.
      </p>
    </div>
  );
}
