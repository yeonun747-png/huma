'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { ContentType } from '@huma/shared';
import { api } from '@/lib/api';
import {
  calcReviewDurationMs,
  DEFAULT_HUMAN_ENGINE_SIM,
  formatPasteTypeRatio,
  LiveTextBuffer,
  mergeHumanEngineSim,
  randomBetween,
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
import { simHumanClickTarget } from '@/lib/naver-sim-mouse';
import {
  NaverSmartEditorChrome,
  type NaverEditorChromeHandle,
  type NaverSimTarget,
} from '@/components/posting/naver-smart-editor-chrome';

const VIEWPORT_POOL: [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1680, 1050],
  [1920, 1080],
  [2560, 1440],
];

function previewViewportLabel(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  const [w, height] = VIEWPORT_POOL[h % VIEWPORT_POOL.length]!;
  return `${w}×${height}`;
}

function resolveInsertLinkUrl(workspace: string, linkUrl: string): string {
  return linkUrl.trim();
}

function buildOgLinkCard(url: string, workspace: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'overflow-hidden rounded border border-[#e0e0e0] bg-white shadow-sm';

  const thumb = document.createElement('div');
  thumb.className =
    workspace === 'yeonun'
      ? 'flex h-24 items-center justify-center bg-gradient-to-br from-[#1a1020] via-[#2d1838] to-[#c0506e]/40'
      : 'h-24 bg-gradient-to-br from-[#eef2ff] to-[#f8fafc]';

  if (workspace === 'yeonun') {
    const brand = document.createElement('span');
    brand.className = 'text-[13px] font-bold tracking-wide text-white/90';
    brand.textContent = '연운 緣運';
    thumb.appendChild(brand);
  }

  const body = document.createElement('div');
  body.className = 'border-t border-[#eee] px-3 py-2';
  const titleEl = document.createElement('div');
  titleEl.className = 'truncate text-[12px] font-semibold text-[#333]';
  titleEl.textContent =
    workspace === 'yeonun' ? '연운 緣運 — 운명을, 듣다' : 'OG 링크 미리보기';
  const urlEl = document.createElement('div');
  urlEl.className = 'truncate font-mono text-[10px] text-[#888]';
  urlEl.textContent = url;
  body.appendChild(titleEl);
  body.appendChild(urlEl);
  card.appendChild(thumb);
  card.appendChild(body);
  return card;
}

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
  workspace,
  imageUrl,
  contentType = 'A',
  hashtags,
  viewportSeed,
  showVideoStep = false,
}: {
  title: string;
  body: string;
  linkUrl?: string | null;
  workspace?: string | null;
  imageUrl?: string | null;
  contentType?: ContentType;
  hashtags?: string[];
  viewportSeed?: string;
  showVideoStep?: boolean;
}) {
  const [engine, setEngine] = useState<HumanEngineSimConfig>(DEFAULT_HUMAN_ENGINE_SIM);
  const [engineReady, setEngineReady] = useState(false);
  const [phase, setPhase] = useState<PostingPhase>('enter_editor');
  const [donePhases, setDonePhases] = useState<Set<PostingPhase>>(new Set());
  const [reviewSec, setReviewSec] = useState<number | null>(null);
  const [published, setPublished] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [activeToolbar, setActiveToolbar] = useState<NaverSimTarget | null>(null);
  const [tagChips, setTagChips] = useState<string[]>([]);
  const [tagTyping, setTagTyping] = useState('');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [reviewCaret, setReviewCaret] = useState<{ x: number; y: number; height: number } | null>(null);

  const chromeRef = useRef<NaverEditorChromeHandle>(null);
  const titleHostRef = useRef<HTMLDivElement>(null);
  const bodyTextHostRef = useRef<HTMLDivElement>(null);
  const imageSlotRef = useRef<HTMLDivElement>(null);
  const linkSlotRef = useRef<HTMLDivElement>(null);
  const titleCursorRef = useRef<HTMLSpanElement>(null);
  const bodyCursorRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const metaRef = useRef<HTMLSpanElement>(null);
  const cancelRef = useRef(false);
  const runTokenRef = useRef(0);
  const imageInsertedRef = useRef(false);
  const titleBufferRef = useRef<LiveTextBuffer | null>(null);
  const bodyBufferRef = useRef<LiveTextBuffer | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  const ws = workspace ?? 'yeonun';
  /** postNaverBlog()는 OG·툴바 링크 삽입 없음 — 본문·후행 이미지만 */
  const showLinkStep = false;
  const insertLink = '';
  const simBody = body;
  const viewportLabel = previewViewportLabel(viewportSeed ?? `${ws}-${title.length}`);

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
    label.textContent = '📷 사진 업로드 (insertImageViaToolbar)';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '본문 삽입 이미지';
    img.className = 'mx-auto max-h-[min(480px,55vh)] w-auto max-w-full rounded object-contain';
    img.decoding = 'async';
    wrap.appendChild(label);
    wrap.appendChild(img);
    slot.appendChild(wrap);
    wrap.scrollIntoView({ block: 'nearest' });
    imageInsertedRef.current = true;
  };

  const insertLinkBlock = (url: string) => {
    const slot = linkSlotRef.current;
    if (!slot || slot.childElementCount > 0) return;

    const wrap = document.createElement('div');
    wrap.dataset.simLink = '1';
    wrap.className = 'my-4 rounded border border-dashed border-[#5b7fff]/40 bg-[#f5f8ff] p-2';

    const label = document.createElement('div');
    label.className = 'mb-2 text-[10px] text-[#5b7fff]';
    label.textContent =
      ws === 'yeonun'
        ? '🔗 OG 링크 (본문 Ctrl+V · pasteBlogLinkWithOgPreview)'
        : '🔗 링크 삽입 (툴바 「링크」 · pasteBlogLinkWithOgPreview)';

    wrap.appendChild(label);
    wrap.appendChild(buildOgLinkCard(url, ws));
    slot.appendChild(wrap);
    wrap.scrollIntoView({ block: 'nearest' });
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
    setPublishOpen(false);
    setLinkDialogOpen(false);
    setActiveToolbar(null);
    setTagChips([]);
    setTagTyping('');
    setReviewCaret(null);

    if (titleHostRef.current) titleHostRef.current.textContent = '';
    if (bodyTextHostRef.current) bodyTextHostRef.current.textContent = '';
    if (imageSlotRef.current) imageSlotRef.current.replaceChildren();
    if (linkSlotRef.current) linkSlotRef.current.replaceChildren();

    mouseRef.current = {
      x: typeof window !== 'undefined' ? window.innerWidth * 0.35 : 400,
      y: typeof window !== 'undefined' ? window.innerHeight * 0.35 : 300,
    };

    const run = async () => {
      if (runToken !== runTokenRef.current) return;
      const cfg = engine;
      let reviewFixes: ReviewTypoFix[] = [];

      const cancelled = () => cancelRef.current || runToken !== runTokenRef.current;

      const clickTarget = async (id: NaverSimTarget, flashMs = 450) => {
        const el = chromeRef.current?.getTarget(id);
        if (!el) {
          await sleepMs(flashMs, cancelled);
          return;
        }
        setActiveToolbar(id);
        const pos = await simHumanClickTarget(el, mouseRef.current, {
          onMouseMove: (x, y) => {
            mouseRef.current = { x, y };
            setMousePos({ x, y });
          },
          onMouseClick: () => setMousePos({ ...mouseRef.current }),
          cancelled,
        });
        mouseRef.current = pos;
        await sleepMs(flashMs, cancelled);
        setActiveToolbar(null);
      };

      setPhase('enter_editor');
      if (statusRef.current) statusRef.current.textContent = 'Playwright: enterBlogEditor()';
      await sleepMs(1200 + Math.random() * 800, cancelled);
      if (cancelled()) return;
      markDone('enter_editor');

      setPhase('title');
      setCursor('title');
      if (statusRef.current) statusRef.current.textContent = 'humanClickLocator(#subjectTextBox) + humanType';
      await clickTarget('title', 300);
      if (titleHostRef.current) titleBufferRef.current = new LiveTextBuffer(titleHostRef.current);
      await humanTypeSim(title.trim(), titleBufferRef.current!, cfg, cancelled);
      if (cancelled()) return;
      markDone('title');

      setPhase('title_pause');
      setCursor('none');
      if (statusRef.current) statusRef.current.textContent = '제목 입력 후 2~5초 사고 정지';
      await sleepMs(2000 + Math.random() * 3000, cancelled);
      if (cancelled()) return;
      markDone('title_pause');

      setPhase('body_click');
      if (statusRef.current) statusRef.current.textContent = 'humanClickLocator(.se-content)';
      await clickTarget('body', 350);
      if (cancelled()) return;
      markDone('body_click');

      setPhase('body');
      setCursor('body');
      if (statusRef.current) {
        statusRef.current.textContent = `typePostContent · ${formatPasteTypeRatio(cfg.paste_ratio)}`;
      }
      if (bodyTextHostRef.current) bodyBufferRef.current = new LiveTextBuffer(bodyTextHostRef.current);
      await typePostContentSim(simBody, bodyBufferRef.current!, cfg, cancelled, followBody, {
        onPaste: () => {
          setKeyHint('Ctrl+V');
          window.setTimeout(() => setKeyHint(null), 600);
        },
      });
      if (cancelled()) return;
      reviewFixes = plantReviewTypos(bodyBufferRef.current!, 2, 4);
      markDone('body');

      if (showLinkStep && insertLink) {
        const pasteUrl = resolveInsertLinkUrl(ws, insertLink);
        setPhase('link');
        if (ws === 'yeonun') {
          if (statusRef.current) {
            statusRef.current.textContent = '본문 Ctrl+V · https://yeonun.com/ → OG 카드';
          }
          setCursor('body');
          await clickTarget('body', 300);
          setKeyHint('Ctrl+V');
          await sleepMs(400 + Math.random() * 300, cancelled);
          setKeyHint(null);
          insertLinkBlock(pasteUrl);
          await sleepMs(1500 + Math.random() * 2000, cancelled);
        } else {
          if (statusRef.current) {
            statusRef.current.textContent = 'clickEditorToolbar(링크) → URL humanType → 확인';
          }
          await clickTarget('toolbar-link', 600);
          setLinkDialogOpen(true);
          await sleepMs(350 + Math.random() * 250, cancelled);
          const dialogInput = chromeRef.current?.getTarget('link-dialog-input');
          if (dialogInput) {
            dialogInput.replaceChildren();
            const typingSpan = document.createElement('span');
            typingSpan.className = 'text-[#333]';
            dialogInput.appendChild(typingSpan);
            await humanTypeSim(pasteUrl, new LiveTextBuffer(typingSpan), cfg, cancelled);
          }
          if (cancelled()) return;
          await clickTarget('link-dialog-confirm', 500);
          setLinkDialogOpen(false);
          insertLinkBlock(pasteUrl);
          await sleepMs(1200 + Math.random() * 1800, cancelled);
        }
        if (cancelled()) return;
        markDone('link');
      }

      if (imageUrl) {
        setPhase('image_upload');
        setCursor('none');
        if (statusRef.current) statusRef.current.textContent = 'insertImageViaToolbar · 툴바 「사진」 humanClick';
        await clickTarget('toolbar-photo', 800);
        await sleepMs(1200 + Math.random() * 1200, cancelled);
        if (cancelled()) return;
        insertImageOnce(imageUrl);
        await sleepMs(1000 + Math.random() * 2000, cancelled);
        if (cancelled()) return;
        markDone('image_upload');
      }

      if (showVideoStep) {
        setPhase('video_upload');
        setCursor('none');
        if (statusRef.current) statusRef.current.textContent = 'insertVideoViaToolbar · 툴바 「동영상」 humanClick';
        await clickTarget('toolbar-video', 800);
        await sleepMs(1500 + Math.random() * 2000, cancelled);
        if (cancelled()) return;
        markDone('video_upload');
      }

      setPhase('review');
      setCursor('none');
      const reviewMs = calcReviewDurationMs(
        title.trim().length + (bodyBufferRef.current?.length ?? simBody.length) + (insertLink?.length ?? 0),
        cfg.review_duration_ms,
      );
      if (statusRef.current) statusRef.current.textContent = 'scrollReview · 오탈자 찾아 수정';
      const scrollEl = chromeRef.current?.getScrollRoot();
      const bodyHost = bodyTextHostRef.current;
      if (scrollEl && bodyHost && bodyBufferRef.current) {
        await simulateTypoReview(
          scrollEl,
          bodyHost,
          bodyBufferRef.current,
          reviewFixes,
          Math.round(reviewMs),
          cancelled,
          {
            onProgress: (sec) => setReviewSec(sec),
            onMouseMove: (x, y) => {
              mouseRef.current = { x, y };
              setMousePos({ x, y });
            },
            onMouseClick: () => setMousePos({ ...mouseRef.current }),
            onKeyNav: (key) => {
              setKeyHint(key);
              window.setTimeout(() => setKeyHint(null), 600);
            },
            onCaretAt: (point) => setReviewCaret(point),
          },
        );
      }
      setReviewCaret(null);
      if (cancelled()) return;
      markDone('review');
      setReviewSec(null);

      setPhase('publish');
      if (statusRef.current) statusRef.current.textContent = 'clickTopPublishButton() humanClick';
      await clickTarget('publish-top', 500);
      setPublishOpen(true);
      if (cancelled()) return;
      markDone('publish');

      setPhase('publish_dialog');
      if (statusRef.current) statusRef.current.textContent = 'selectPublishCategory() humanClick';
      await sleepMs(400, cancelled);
      await clickTarget('category', 500);
      if (cancelled()) return;
      markDone('publish_dialog');

      setPhase('publish_tags');
      if (statusRef.current) statusRef.current.textContent = 'typePublishTags() · # + humanType → Space/Enter';
      const tags = (hashtags ?? [])
        .map((t) => t.replace(/^#/, '').trim())
        .filter(Boolean);
      if (tags.length) {
        await clickTarget('tag-input', 400);
        const completed: string[] = [];
        for (const tag of tags) {
          setTagTyping('');
          const tagText = `#${tag}`;
          for (let i = 0; i < tagText.length; i++) {
            if (cancelled()) return;
            setTagTyping(tagText.slice(0, i + 1));
            await sleepMs(
              randomBetween(
                Math.round(60000 / (cfg.wpm_mean * 5) * 0.6),
                Math.round(60000 / (cfg.wpm_mean * 5) * 1.4),
              ),
              cancelled,
            );
          }
          await sleepMs(200 + Math.random() * 350, cancelled);
          const confirmKey = Math.random() < 0.75 ? 'Space' : 'Enter';
          setKeyHint(confirmKey);
          await sleepMs(350 + Math.random() * 400, cancelled);
          setKeyHint(null);
          completed.push(tag);
          setTagChips([...completed]);
          setTagTyping('');
        }
        await sleepMs(500, cancelled);
      }
      if (cancelled()) return;
      markDone('publish_tags');

      setPhase('publish_confirm');
      if (statusRef.current) statusRef.current.textContent = 'clickConfirmPublish() humanClick';
      await clickTarget('publish-confirm', 500);
      if (cancelled()) return;
      setPublished(true);
      markDone('publish_confirm');

      setPhase('done');
      setCursor('none');
      if (statusRef.current) statusRef.current.textContent = 'Playwright 발행 재현 완료';
      if (metaRef.current) {
        metaRef.current.textContent = `본문 ${bodyBufferRef.current?.length ?? 0}자 · ${viewportLabel} · WPM ${cfg.wpm_mean}`;
      }
    };

    void run();
    return () => {
      cancelRef.current = true;
    };
  }, [title, simBody, insertLink, showLinkStep, showVideoStep, ws, imageUrl, contentType, engine, engineReady, hashtags, viewportLabel]);

  const phaseOrder: PostingPhase[] = [
    'enter_editor',
    'title',
    'title_pause',
    'body_click',
    'body',
    ...(showLinkStep ? (['link'] as PostingPhase[]) : []),
    ...(imageUrl ? (['image_upload'] as PostingPhase[]) : []),
    ...(showVideoStep ? (['video_upload'] as PostingPhase[]) : []),
    'review',
    'publish',
    'publish_dialog',
    'publish_tags',
    'publish_confirm',
    'done',
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-huma-bdr bg-huma-bg2 shadow-lg">
      {reviewCaret && (
        <span
          className="naver-editor-cursor pointer-events-none fixed z-[9998]"
          style={{
            left: reviewCaret.x,
            top: reviewCaret.y,
            height: reviewCaret.height,
          }}
          aria-hidden
        />
      )}
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
          <span className="ml-auto text-[10px] text-huma-t3">타입 {contentType} · {viewportLabel}</span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-huma-t3">
          postNaverBlog() · humanClickLocator(베지어) · WPM {engine.wpm_mean}
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

        <div className="flex min-h-0 min-w-0 flex-col">
          <NaverSmartEditorChrome
            ref={chromeRef}
            publishOpen={publishOpen}
            linkDialogOpen={linkDialogOpen}
            activeToolbar={activeToolbar}
            tagChips={tagChips}
            tagTyping={tagTyping}
            viewportLabel={viewportLabel}
            titleSlot={
              <>
                <div ref={titleHostRef} className="naver-editor-title-text inline" />
                <span ref={titleCursorRef} className="naver-editor-cursor" aria-hidden />
              </>
            }
            bodySlot={
              <>
                <div ref={bodyTextHostRef} className="naver-editor-body-text inline" />
                <span ref={bodyCursorRef} className="naver-editor-cursor" style={{ visibility: 'hidden' }} aria-hidden />
              </>
            }
            imageSlot={<div ref={imageSlotRef} />}
            linkSlot={<div ref={linkSlotRef} />}
          />

          <div className="mx-3 mb-2 mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded bg-huma-bg3 px-3 py-1.5">
            <span ref={statusRef} className="text-[11px] text-huma-t2">
              Playwright 시뮬 준비…
            </span>
            <span ref={metaRef} className="font-mono text-[10px] text-[#c4a0ae]" />
          </div>

          {published && (
            <div className="mx-3 mb-3 shrink-0 rounded border border-huma-ok/40 bg-huma-ok/10 px-4 py-2 text-center text-[12px] text-huma-ok">
              ✓ completeNaverPublishDialog() (검증 모드 — 네이버에 올라가지 않음)
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/** @deprecated alias */
export const NaverEditorSimulator = PlaywrightPostingReplay;
