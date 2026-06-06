'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { ContentType } from '@huma/shared';
import { api } from '@/lib/api';
import {
  DEFAULT_HUMAN_ENGINE_SIM,
  LiveTextBuffer,
  mergeHumanEngineSim,
  plantReviewTypos,
  POSTING_PHASE_LABELS,
  simulateTypoReview,
  sleepMs,
  humanTypeSim,
  typePostContentSim,
  type HumanEngineSimConfig,
  type PostingPhase,
  type ReviewTypoFix,
} from '@/lib/human-typing-sim';
import { normalizeBlogLink, prepareBodyForTypingSim } from '@/lib/naver-post-sanitize';

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
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [keyHint, setKeyHint] = useState<string | null>(null);

  const titleHostRef = useRef<HTMLDivElement>(null);
  const bodyTextHostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageSlotRef = useRef<HTMLDivElement>(null);
  const titleCursorRef = useRef<HTMLSpanElement>(null);
  const bodyCursorRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const metaRef = useRef<HTMLSpanElement>(null);
  const cancelRef = useRef(false);
  const runTokenRef = useRef(0);
  const imageInsertedRef = useRef(false);
  const titleBufferRef = useRef<LiveTextBuffer | null>(null);
  const bodyBufferRef = useRef<LiveTextBuffer | null>(null);

  const blogLink = normalizeBlogLink(linkUrl);
  const simBody = prepareBodyForTypingSim(body, { contentType, linkUrl: blogLink });

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

  const insertImageOnce = (url: string) => {
    if (imageInsertedRef.current) return;
    const slot = imageSlotRef.current;
    if (!slot || slot.childElementCount > 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'my-4 rounded border border-dashed border-[#03c75a]/50 bg-[#f0faf4] p-2';
    wrap.dataset.simImage = '1';
    const label = document.createElement('div');
    label.className = 'mb-2 text-[10px] text-[#03c75a]';
    label.textContent = '📷 사진 업로드 완료 (Imagen → uniquify 후 삽입)';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '본문 삽입 이미지';
    img.className = 'mx-auto max-h-[360px] rounded object-contain';
    img.decoding = 'async';
    wrap.appendChild(label);
    wrap.appendChild(img);
    slot.appendChild(wrap);
    wrap.scrollIntoView({ block: 'nearest' });
    imageInsertedRef.current = true;
  };

  useEffect(() => {
    if (!engineReady) return;

    const runToken = ++runTokenRef.current;
    cancelRef.current = false;
    imageInsertedRef.current = false;
    setPhase('enter_editor');
    setDonePhases(new Set());
    setReviewSec(null);
    setPublished(false);
    setMousePos(null);
    setKeyHint(null);

    if (titleHostRef.current) titleHostRef.current.textContent = '';
    if (bodyTextHostRef.current) bodyTextHostRef.current.textContent = '';
    if (imageSlotRef.current) imageSlotRef.current.replaceChildren();

    const run = async () => {
      if (runToken !== runTokenRef.current) return;
      const cfg = engine;
      let reviewFixes: ReviewTypoFix[] = [];

      setPhase('enter_editor');
      if (statusRef.current) statusRef.current.textContent = 'Playwright: enterBlogEditor()';
      await sleepMs(1200 + Math.random() * 800, () => cancelRef.current || runToken !== runTokenRef.current);
      if (runToken !== runTokenRef.current) return;
      markDone('enter_editor');

      setPhase('title');
      setCursor('title');
      if (statusRef.current) statusRef.current.textContent = `humanType · WPM ${cfg.wpm_mean} · 오타 ${Math.round(cfg.typo_rate * 100)}%`;
      if (titleHostRef.current) titleBufferRef.current = new LiveTextBuffer(titleHostRef.current);
      await humanTypeSim(title.trim(), titleBufferRef.current!, cfg, () => cancelRef.current || runToken !== runTokenRef.current);
      if (runToken !== runTokenRef.current) return;
      markDone('title');

      setPhase('title_pause');
      setCursor('none');
      if (statusRef.current) statusRef.current.textContent = '제목 입력 후 2~5초 사고 정지';
      await sleepMs(2000 + Math.random() * 3000, () => cancelRef.current || runToken !== runTokenRef.current);
      if (runToken !== runTokenRef.current) return;
      markDone('title_pause');

      setPhase('body_click');
      if (statusRef.current) statusRef.current.textContent = '본문 에디터 (.se-content) 클릭';
      await sleepMs(400 + Math.random() * 400, () => cancelRef.current || runToken !== runTokenRef.current);
      if (runToken !== runTokenRef.current) return;
      markDone('body_click');

      setPhase('body');
      setCursor('body');
      if (statusRef.current) statusRef.current.textContent = 'typePostContent · 서비스화면 복붙 30% / 타이핑 70%';
      if (bodyTextHostRef.current) bodyBufferRef.current = new LiveTextBuffer(bodyTextHostRef.current);
      await typePostContentSim(simBody, bodyBufferRef.current!, cfg, () => cancelRef.current || runToken !== runTokenRef.current, followBody);
      if (runToken !== runTokenRef.current) return;
      reviewFixes = plantReviewTypos(bodyBufferRef.current!, 2, 4);
      markDone('body');

      if (blogLink) {
        setPhase('link');
        if (statusRef.current) statusRef.current.textContent = '링크 URL humanType';
        await humanTypeSim(`\n\n${blogLink}`, bodyBufferRef.current!, cfg, () => cancelRef.current || runToken !== runTokenRef.current, followBody);
        if (runToken !== runTokenRef.current) return;
        markDone('link');
      }

      if (imageUrl) {
        setPhase('image_upload');
        setCursor('none');
        if (statusRef.current) statusRef.current.textContent = 'insertImage · input[type=file] setInputFiles';
        await sleepMs(2000 + Math.random() * 2000, () => cancelRef.current || runToken !== runTokenRef.current);
        if (runToken !== runTokenRef.current) return;
        insertImageOnce(imageUrl);
        await sleepMs(1000 + Math.random() * 2000, () => cancelRef.current || runToken !== runTokenRef.current);
        if (runToken !== runTokenRef.current) return;
        markDone('image_upload');
      }

      setPhase('review');
      setCursor('none');
      const reviewMs = cfg.review_duration_ms[0] + Math.random() * (cfg.review_duration_ms[1] - cfg.review_duration_ms[0]);
      if (statusRef.current) statusRef.current.textContent = 'scrollReview · 오탈자 찾아 수정';
      const scrollEl = scrollRef.current;
      const bodyHost = bodyTextHostRef.current;
      if (scrollEl && bodyHost && bodyBufferRef.current) {
        await simulateTypoReview(
          scrollEl,
          bodyHost,
          bodyBufferRef.current,
          reviewFixes,
          Math.round(reviewMs),
          () => cancelRef.current || runToken !== runTokenRef.current,
          {
            onProgress: (sec) => setReviewSec(sec),
            onMouseMove: (x, y) => setMousePos({ x, y }),
            onMouseClick: () => {
              setMousePos((p) => (p ? { ...p } : p));
            },
            onKeyNav: (key) => {
              setKeyHint(key);
              window.setTimeout(() => setKeyHint(null), 600);
            },
          },
        );
      }
      if (runToken !== runTokenRef.current) return;
      markDone('review');
      setReviewSec(null);
      setMousePos(null);

      setPhase('publish');
      if (statusRef.current) statusRef.current.textContent = '.publish-btn.click() — 검증 모드: 실제 발행 없음';
      await sleepMs(800, () => cancelRef.current || runToken !== runTokenRef.current);
      if (runToken !== runTokenRef.current) return;
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
  }, [title, simBody, blogLink, imageUrl, contentType, engine, engineReady]);

  const phaseOrder: PostingPhase[] = [
    'enter_editor',
    'title',
    'title_pause',
    'body_click',
    'body',
    ...(blogLink ? (['link'] as PostingPhase[]) : []),
    ...(imageUrl ? (['image_upload'] as PostingPhase[]) : []),
    'review',
    'publish',
    'done',
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-huma-bdr bg-huma-bg2 shadow-lg">
      {mousePos && (
        <div
          className="pointer-events-none fixed z-[9999] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#111] bg-white shadow-md"
          style={{ left: mousePos.x, top: mousePos.y }}
        />
      )}
      {keyHint && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] rounded bg-[#111]/85 px-2 py-1 font-mono text-[11px] text-white">
          {keyHint}
        </div>
      )}

      <div className="shrink-0 border-b border-huma-bdr bg-[#0d1117] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-bold text-huma-err">● LIVE</span>
          <span className="text-[12px] font-semibold text-huma-t">Playwright 네이버 블로그 발행 재현</span>
          <span className="rounded bg-huma-warn/20 px-2 py-0.5 text-[10px] text-huma-warn">dry_run · 실제 발행 없음</span>
          <span className="ml-auto text-[10px] text-huma-t3">타입 {contentType}</span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-huma-t3">
          postNaverBlog() · WPM {engine.wpm_mean} σ{engine.wpm_sigma} · 오타 {Math.round(engine.typo_rate * 100)}%
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
        <div className="overflow-y-auto border-r border-huma-bdr bg-huma-bg3 p-3">
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

        <div className="flex min-h-0 min-w-0 flex-col bg-[#d8d8d8]">
          <div className="naver-editor-canvas mx-3 mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-[#ccc] bg-white shadow-sm">
            <div className="shrink-0 border-b border-[#eee] bg-[#fafafa] px-5 py-2">
              <div className="text-[10px] text-[#888]">제목 · #subjectTextBox</div>
              <div
                className="naver-editor-title-text min-h-[44px] py-1 text-[22px] font-bold leading-snug"
                style={{ fontFamily: 'Malgun Gothic, sans-serif', color: '#111111' }}
              >
                <div ref={titleHostRef} className="naver-editor-title-text inline" style={{ color: '#111111' }} />
                <span ref={titleCursorRef} className="naver-editor-cursor" aria-hidden />
              </div>
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
              style={{ minHeight: '520px' }}
            >
              <div className="mb-1 text-[10px] text-[#aaa]">본문 · .se-content</div>
              <div
                className="naver-editor-body-text min-h-[480px] whitespace-pre-wrap text-[15px] leading-[2]"
                style={{ fontFamily: 'Malgun Gothic, sans-serif', color: '#222222' }}
              >
                <div ref={bodyTextHostRef} className="naver-editor-body-text inline" style={{ color: '#222222' }} />
                <span ref={bodyCursorRef} className="naver-editor-cursor" style={{ visibility: 'hidden' }} aria-hidden />
              </div>
              <div ref={imageSlotRef} />
            </div>
          </div>

          <div className="mx-3 mb-2 mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded bg-huma-bg3 px-3 py-1.5">
            <span ref={statusRef} className="text-[11px] text-huma-t2">
              Playwright 시뮬 준비…
            </span>
            <span ref={metaRef} className="font-mono text-[10px] text-[#c4a0ae]" style={{ color: '#c4a0ae' }} />
          </div>

          {published && (
            <div className="mx-3 mb-3 shrink-0 rounded border border-huma-ok/40 bg-huma-ok/10 px-4 py-2 text-center text-[12px] text-huma-ok">
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
