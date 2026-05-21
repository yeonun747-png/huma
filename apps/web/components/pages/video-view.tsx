'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HumaVideoQueue } from '@huma/shared';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { MGrid, MPanel, MStat, MTable, MTag } from '@/components/mockup/primitives';
import { DEFAULT_TTS_MODEL, TTS_MODELS, normalizeTtsModel, ttsModelLabel } from '@/lib/tts-models';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const PIPE_STEPS = ['image_generating', 'video_generating', 'tts_generating', 'ffmpeg_merging', 'uploading'];

export function VideoPipelineView() {
  const { workspace } = useWorkspace();
  const [items, setItems] = useState<HumaVideoQueue[]>([]);
  const [imgModel, setImgModel] = useState('nano-banana-pro');
  const [vidModel, setVidModel] = useState('kling-3.0');
  const [ttsModel, setTtsModel] = useState(DEFAULT_TTS_MODEL);
  const [autoBgm, setAutoBgm] = useState(true);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    Promise.all([
      api.videoQueue(),
      api.getSetting('higgsfield').catch(() => ({})),
    ]).then(([all, hg]) => {
      setItems(all.filter((v) => v.workspace === workspace));
      const defaultTts = normalizeTtsModel(String((hg as Record<string, unknown>).default_tts_model ?? DEFAULT_TTS_MODEL));
      setTtsModel(defaultTts);
    }).catch(() => setItems([]));
  }, [workspace]);

  useEffect(() => { load(); }, [load]);

  const startPipeline = async () => {
    const model = normalizeTtsModel(ttsModel);
    await api.createVideo({
      workspace,
      image_prompt: 'cinematic character portrait, 9:16',
      video_prompt: 'slow camera zoom, emotional scene',
      tts_script: '오늘 하루, 당신에게 전하는 위로의 말.',
      image_model: imgModel,
      video_model: vidModel,
      tts_model: model,
      auto_bgm: autoBgm,
      upload_platforms: ['tiktok', 'instagram'],
    });
    load();
  };

  useRegisterPageAction('startVideoPipeline', startPipeline);

  const running = items.find((v) => v.status !== 'done' && v.status !== 'failed');
  const doneToday = items.filter((v) => v.status === 'done').length;

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MStat label="오늘 생성" value={items.length} sub="9:16 완료" />
        <MStat label="진행중" value={running ? 1 : 0} tone="warn" sub="파이프라인 중" />
        <MStat label="업로드 완료" value={doneToday} tone="ok" sub="TikTok·IG" />
        <MStat label="크레딧 잔여" value={842} sub="1,000중 사용 158" />
      </MGrid>
      <MGrid cols={2}>
        <MPanel title="새 영상 생성 요청">
          <div ref={formRef} className="flex flex-col gap-2.5">
            <div>
              <div className="mb-1 font-mono text-[9.5px] tracking-wide text-huma-t3">① 이미지 모델 (7 크레딧)</div>
              <select className="m-model-select" value={imgModel} onChange={(e) => setImgModel(e.target.value)}>
                <option value="nano-banana-pro">🍌 Nano Banana Pro</option>
                <option value="flux2-max">🔥 FLUX.2 Max</option>
              </select>
            </div>
            <div>
              <div className="mb-1 font-mono text-[9.5px] tracking-wide text-huma-t3">② 영상 모델</div>
              <select className="m-model-select" value={vidModel} onChange={(e) => setVidModel(e.target.value)}>
                <option value="kling-3.0">🎥 Kling 3.0</option>
                <option value="seedance-2.0">🌟 Seedance 2.0</option>
              </select>
            </div>
            <div>
              <div className="mb-1 font-mono text-[9.5px] tracking-wide text-huma-t3">③ TTS (ElevenLabs · Higgsfield)</div>
              <select className="m-model-select" value={ttsModel} onChange={(e) => setTtsModel(normalizeTtsModel(e.target.value))}>
                {TTS_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <div className="mt-1 font-mono text-[9px] text-huma-t3">{ttsModelLabel(ttsModel)} · {TTS_MODELS.find((m) => m.id === ttsModel)?.sub}</div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-huma-bdr bg-huma-bg3 px-2.5 py-2">
              <div>
                <div className="text-[11.5px] text-huma-t">자동 선택 (태그 매칭)</div>
                <div className="font-mono text-[9.5px] text-huma-t3">Supabase BGM → Suno AI 폴백</div>
              </div>
              <button type="button" className={`m-tgl ${autoBgm ? 'on' : ''}`} onClick={() => setAutoBgm(!autoBgm)} />
            </div>
            <button type="button" className="btn-primary w-full py-2" onClick={startPipeline}>▶ 파이프라인 시작</button>
          </div>
        </MPanel>
        <MPanel title="진행 중인 파이프라인">
          {PIPE_STEPS.map((step, i) => {
            const active = running?.current_step === step || running?.status === step;
            const done = running && PIPE_STEPS.indexOf(running.current_step ?? '') > i;
            return (
              <div key={step} className={`m-pipe-step ${!running ? 'opacity-50' : ''}`}>
                <div className={`m-pipe-step-num ${done ? 'done' : active ? 'running' : 'idle'}`}>{i + 1}</div>
                <div className="flex-1">
                  <div className="m-pipe-step-title">{step.replace(/_/g, ' ')}</div>
                  <div className="m-pipe-step-sub">{running?.image_prompt?.slice(0, 40) ?? '대기 중'}</div>
                </div>
                <span className="m-model-badge">{done ? '완료' : active ? '진행중' : '대기'}</span>
              </div>
            );
          })}
        </MPanel>
      </MGrid>
      <MPanel title="오늘 완료된 영상">
        <MTable
          head={['영상', '이미지 모델', '영상 모델', 'TTS', 'BGM', '크레딧', '업로드']}
          rows={items.slice(0, 5).map((v) => [
            v.image_prompt?.slice(0, 20) ?? v.id.slice(0, 8),
            <span key="i" className="font-mono text-[9.5px]">{v.image_model ?? imgModel}</span>,
            <span key="v" className="font-mono text-[9.5px]">{v.video_model ?? vidModel}</span>,
            <span key="t" className="font-mono text-[9.5px]">{ttsModelLabel(v.tts_model ?? ttsModel)}</span>,
            '자동',
            <span key="c" className="font-mono ok">28크</span>,
            <MTag key="u" tone={v.status === 'done' ? 'ok' : 'idle'}>{v.status === 'done' ? 'TikTok ✓' : '대기'}</MTag>,
          ])}
        />
      </MPanel>
    </div>
  );
}
