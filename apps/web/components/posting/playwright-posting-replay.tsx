'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { ContentType } from '@huma/shared';
import { api } from '@/lib/api';
import {
  DEFAULT_HUMAN_ENGINE_SIM,
  LiveTextBuffer,
  mergeHumanEngineSim,
  POSTING_PHASE_LABELS,
  simulateScrollReview,
  sleepMs,
  humanTypeSim,
  typePostContentSim,
  type HumanEngineSimConfig,
  type PostingPhase,
} from '@/lib/human-typing-sim';

function PhaseRow({ phase, current, done }: { phase: PostingPhase; current: PostingPhase; done: boolean }) {
  const active = phase === current;
  const completed = done;
  return (
    <li className={`flex items-center gap-2 text-[11px] ${active ? 'text-huma-acc font-semibold' : completed ? 'text-huma-ok' : 'text-huma-t3'}`}>
      <span>{completed ? '✓' : active ? '●' : '○'}</span>
      <span>{POSTING_PHASE_LABELS[phase]}</span>
    </li>
  );
}

export const PlaywrightPostingReplay = memo(function PlaywrightPostingReplay({
  title,
  body,
  linkUrl,
  imageUrl,
  contentType = 'A',
}: {
  title: string;
  body: string;
  linkUrl?: string | null;
  imageUrl?: string | null;
  contentType?: ContentType;
}) {
  const [engine, setEngine] = useState<HumanEngineSimConfig>(DEFAULT_HUMAN_ENGINE_SIM);
  const [engineReady, setEngineReady] = useState(false);
  const [phase, setPhase] = useState<PostingPhase>('enter_editor');
  const [donePhases, setDonePhases] = useState<Set<PostingPhase>>(new Set());
  const [reviewSec, setReviewSec] = useState<number | null>(null);
  const [published, setPublished] = useState(false);

  const titleHostRef = useRef<HTMLDivElement>(null);
  const bodyHostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageSlotRef = useRef<HTMLDivElement>(null);
  const titleCursorRef = useRef<HTMLSpanElement>(null);
  const bodyCursorRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const metaRef = useRef<HTMLSpanElement>(null);
  const cancelRef = useRef(false);
  const titleBufferRef = useRef<LiveTextBuffer | null>(null);
  const bodyBufferRef = useRef<LiveTextBuffer | null>(null);

  useEffect(() => {
    void api.getSetting('human_engine').then((raw) => {
      setEngine(mergeHumanEngineSim(raw));
    }).catch(() => {}).finally(() => setEngineReady(true));
  }, []);

  const markDone = (p: PostingPhase) => {
    setDonePhases((prev) => new Set(prev).add(p));
  };

  const setCursor = (target: 'title' | 'body' | 'none') => {
    titleCursorRef.current?.style.setProperty('visibility', target === 'title' ? 'visible' : 'hidden');
    bodyCursorRef.current?.style.setProperty('visibility', target === 'body' ? 'visible' : 'hidden');
  };

  const followBody = () => {
    bodyCursorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  };

  useEffect(() => {
    if (!engineReady) return;

    cancelRef.current = false;
    setPhase('enter_editor');
    setDonePhases(new Set());
    setReviewSec(null);
    setPublished(false);

    if (titleHostRef.current) titleHostRef.current.textContent = '';
    if (bodyHostRef.current) bodyHostRef.current.textContent = '';
    if (imageSlotRef.current) imageSlotRef.current.replaceChildren();

    const run = async () => {
      const cfg = engine;

      // enterBlogEditor
      setPhase('enter_editor');
      if (statusRef.current) statusRef.current.textContent = 'Playwright: enterBlogEditor()';
      await sleepMs(1200 + Math.random() * 800, () => cancelRef.current);
      markDone('enter_editor');

      // title — humanType #subjectTextBox
      setPhase('title');
      setCursor('title');
      if (statusRef.current) statusRef.current.textContent = `humanType · WPM ${cfg.wpm_mean} · 오타 ${Math.round(cfg.typo_rate * 100)}%`;
      if (titleHostRef.current) titleBufferRef.current = new LiveTextBuffer(titleHostRef.current);
      await humanTypeSim(title.trim(), titleBufferRef.current!, cfg, () => cancelRef.current);
      markDone('title');

      // scaledHumanSleep 2~5s
      setPhase('title_pause');
      setCursor('none');
      if (statusRef.current) statusRef.current.textContent = '제목 입력 후 2~5초 사고 정지';
      await sleepMs(2000 + Math.random() * 3000, () => cancelRef.current);
      markDone('title_pause');

      // click body
      setPhase('body_click');
      if (statusRef.current) statusRef.current.textContent = '본문 에디터 (.se-content) 클릭';
      await sleepMs(400 + Math.random() * 400, () => cancelRef.current);
      markDone('body_click');

      // typePostContent — raw body (Playwright와 동일)
      setPhase('body');
      setCursor('body');
      if (statusRef.current) statusRef.current.textContent = 'typePostContent · 복붙 30% / 타이핑 70%';
      if (bodyHostRef.current) bodyBufferRef.current = new LiveTextBuffer(bodyHostRef.current);
      await typePostContentSim(body, bodyBufferRef.current!, cfg, () => cancelRef.current, followBody);
      markDone('body');

      // linkUrl
      if (linkUrl?.trim()) {
        setPhase('link');
        if (statusRef.current) statusRef.current.textContent = '링크 URL humanType';
        await humanTypeSim(`\n\n${linkUrl.trim()}`, bodyBufferRef.current!, cfg, () => cancelRef.current, followBody);
        markDone('link');
      }

      // insertImage — 본문 끝 (blog-editor.ts 순서)
      if (imageUrl) {
        setPhase('image_upload');
        setCursor('none');
        if (statusRef.current) statusRef.current.textContent = 'insertImage · input[type=file] setInputFiles';
        await sleepMs(2000 + Math.random() * 2000, () => cancelRef.current);
        const slot = imageSlotRef.current;
        if (slot) {
          const wrap = document.createElement('div');
          wrap.className = 'my-4 rounded border border-dashed border-[#03c75a]/50 bg-[#f0faf4] p-2';
          const label = document.createElement('div');
          label.className = 'mb-2 text-[10px] text-[#03c75a]';
          label.textContent = '📷 사진 업로드 완료 (Imagen → uniquify 후 삽입)';
          const img = document.createElement('img');
          img.src = imageUrl;
          img.alt = '본문 삽입 이미지';
          img.className = 'mx-auto max-h-[360px] rounded object-contain';
          img.decoding = 'async';
          wrap.appendChild(label);
          wrap.appendChild(img);
          slot.appendChild(wrap);
          wrap.scrollIntoView({ block: 'nearest' });
        }
        await sleepMs(1000 + Math.random() * 2000, () => cancelRef.current);
        markDone('image_upload');
      }

      // scrollReview 2~5분
      setPhase('review');
      setCursor('none');
      const reviewMs = cfg.review_duration_ms[0] + Math.random() * (cfg.review_duration_ms[1] - cfg.review_duration_ms[0]);
      if (statusRef.current) statusRef.current.textContent = 'scrollReview · 발행 전 검토';
      const scrollEl = scrollRef.current;
      if (scrollEl) {
        await simulateScrollReview(scrollEl, Math.round(reviewMs), () => cancelRef.current, (sec) => {
          setReviewSec(sec);
        });
      }
      markDone('review');
      setReviewSec(null);

      // publish click
      setPhase('publish');
      if (statusRef.current) statusRef.current.textContent = '.publish-btn.click() — 검증 모드: 실제 발행 없음';
      await sleepMs(800, () => cancelRef.current);
      setPublished(true);
      markDone('publish');

      setPhase('done');
      setCursor('none');
      if (statusRef.current) statusRef.current.textContent = 'Playwright 발행 재현 완료';
      if (metaRef.current) {
        metaRef.current.textContent = `본문 ${bodyBufferRef.current?.length ?? 0}자 · 타입 ${contentType} · 휴먼엔진 WPM ${cfg.wpm_mean}`;
      }
    };

    void run();
    return () => {
      cancelRef.current = true;
    };
  }, [title, body, linkUrl, imageUrl, contentType, engine, engineReady]);

  const phaseOrder: PostingPhase[] = [
    'enter_editor',
    'title',
    'title_pause',
    'body_click',
    'body',
    ...(linkUrl?.trim() ? (['link'] as PostingPhase[]) : []),
    ...(imageUrl ? (['image_upload'] as PostingPhase[]) : []),
    'review',
    'publish',
    'done',
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-huma-bdr bg-huma-bg2 shadow-lg">
      <div className="border-b border-huma-bdr bg-[#0d1117] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-bold text-huma-err">● LIVE</span>
          <span className="text-[12px] font-semibold text-huma-t">Playwright 네이버 블로그 발행 재현</span>
          <span className="rounded bg-huma-warn/20 px-2 py-0.5 text-[10px] text-huma-warn">dry_run · 실제 발행 없음</span>
        </div>
        <div className="mt-1 font-mono text-[10px] text-huma-t3">
          postNaverBlog() · WPM {engine.wpm_mean} σ{engine.wpm_sigma} · 오타 {Math.round(engine.typo_rate * 100)}%
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[220px_1fr]">
        <div className="border-b border-huma-bdr bg-huma-bg3 p-3 md:border-b-0 md:border-r">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-huma-t3">Playwright 단계</div>
          <ul className="space-y-1.5">
            {phaseOrder.filter((p) => p !== 'done').map((p) => (
              <PhaseRow key={p} phase={p} current={phase} done={donePhases.has(p)} />
            ))}
          </ul>
          {reviewSec != null && reviewSec > 0 && (
            <div className="mt-3 rounded bg-huma-glow px-2 py-1.5 text-[10px] text-huma-acc">
              발행 전 검토 · {Math.floor(reviewSec / 60)}:{String(reviewSec % 60).padStart(2, '0')} 남음
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="border-b border-huma-bdr px-4 py-2">
            <div className="text-[10px] text-huma-t3">제목 (#subjectTextBox)</div>
            <div
              className="min-h-[24px] text-[16px] font-semibold text-huma-t"
              style={{ fontFamily: 'Malgun Gothic, sans-serif' }}
            >
              <div ref={titleHostRef} className="inline" />
              <span ref={titleCursorRef} className="naver-editor-cursor" aria-hidden />
            </div>
          </div>

          <div
            ref={scrollRef}
            className="max-h-[min(480px,55vh)] overflow-y-auto px-4 py-3"
          >
            <div className="text-[10px] text-huma-t3">본문 (.se-content)</div>
            <div
              className="whitespace-pre-wrap text-[13px] leading-[1.85] text-huma-t2"
              style={{ fontFamily: 'Malgun Gothic, sans-serif' }}
            >
              <div ref={bodyHostRef} className="inline" />
              <span ref={bodyCursorRef} className="naver-editor-cursor" style={{ visibility: 'hidden' }} aria-hidden />
            </div>
            <div ref={imageSlotRef} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-huma-bdr bg-huma-bg3 px-4 py-2">
            <span ref={statusRef} className="text-[11px] text-huma-t2">
              Playwright 시뮬 준비…
            </span>
            <span ref={metaRef} className="font-mono text-[10px] text-huma-t3" />
          </div>

          {published && (
            <div className="border-t border-huma-ok/40 bg-huma-ok/10 px-4 py-2 text-center text-[12px] text-huma-ok">
              ✓ .publish-btn 클릭됨 (검증 모드 — 네이버에 올라가지 않음)
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/** @deprecated alias */
export const NaverEditorSimulator = PlaywrightPostingReplay;
