'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import type { ContentType } from '@huma/shared';
import { sanitizeBlogPostForNaver, splitNaverParagraphs } from '@/lib/naver-post-sanitize';

function sleep(ms: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const id = window.setTimeout(() => resolve(), ms);
    if (cancelled()) window.clearTimeout(id);
  });
}

function charDelay(ch: string): number {
  if (ch === '\n') return 180 + Math.random() * 220;
  if ('.!?…'.includes(ch)) return 120 + Math.random() * 180;
  if (',;:'.includes(ch)) return 70 + Math.random() * 90;
  if (ch === ' ') return 25 + Math.random() * 35;
  return 38 + Math.random() * 52;
}

function pickPasteIndices(total: number): Set<number> {
  const pasteCount = Math.max(1, Math.floor(total * 0.3));
  const indices = new Set<number>();
  let guard = 0;
  while (indices.size < pasteCount && guard++ < 50) {
    indices.add(Math.floor(Math.random() * total));
  }
  return indices;
}

export const NaverEditorSimulator = memo(function NaverEditorSimulator({
  title,
  body,
  imageUrl,
  contentType = 'A',
}: {
  title: string;
  body: string;
  imageUrl?: string | null;
  contentType?: ContentType;
}) {
  const cleanTitle = useMemo(
    () => sanitizeBlogPostForNaver(title, { contentType }).replace(/\n+/g, ' ').trim(),
    [title, contentType],
  );

  const titleHostRef = useRef<HTMLSpanElement>(null);
  const bodyHostRef = useRef<HTMLSpanElement>(null);
  const titleCursorRef = useRef<HTMLSpanElement>(null);
  const bodyCursorRef = useRef<HTMLSpanElement>(null);
  const imageSlotRef = useRef<HTMLDivElement>(null);
  const klingSlotRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const imageUrlRef = useRef(imageUrl);
  const titleTextNodeRef = useRef<Text | null>(null);
  const bodyTextNodeRef = useRef<Text | null>(null);
  const charCountRef = useRef(0);
  const scrollTickRef = useRef(0);

  useEffect(() => {
    imageUrlRef.current = imageUrl;
  }, [imageUrl]);

  const setCursor = (target: 'title' | 'body' | 'none') => {
    titleCursorRef.current?.style.setProperty('visibility', target === 'title' ? 'visible' : 'hidden');
    bodyCursorRef.current?.style.setProperty('visibility', target === 'body' ? 'visible' : 'hidden');
  };

  const setStatus = (label: string) => {
    if (statusRef.current) statusRef.current.textContent = label;
  };

  const setCharCount = (n: number, done = false) => {
    charCountRef.current = n;
    if (countRef.current) {
      countRef.current.textContent = `${n.toLocaleString()}자${done ? ' · 복붙 30% / 타이핑 70% 시뮬' : ''}`;
    }
  };

  const followCursor = () => {
    scrollTickRef.current += 1;
    if (scrollTickRef.current % 6 !== 0) return;
    bodyCursorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  };

  const appendText = (node: Text | null, chunk: string) => {
    if (!node || !chunk) return;
    node.data += chunk;
    charCountRef.current += chunk.length;
  };

  const resetTextNode = (host: HTMLSpanElement | null, nodeRef: { current: Text | null }) => {
    if (!host) return;
    host.textContent = '';
    const node = document.createTextNode('');
    host.appendChild(node);
    nodeRef.current = node;
  };

  useEffect(() => {
    cancelRef.current = false;
    charCountRef.current = 0;
    scrollTickRef.current = 0;

    resetTextNode(titleHostRef.current, titleTextNodeRef);
    resetTextNode(bodyHostRef.current, bodyTextNodeRef);
    if (imageSlotRef.current) imageSlotRef.current.replaceChildren();
    if (klingSlotRef.current) klingSlotRef.current.replaceChildren();

    setCursor('title');
    setStatus('제목 입력 중…');
    setCharCount(0);

    const insertImage = async () => {
      const url = imageUrlRef.current;
      const slot = imageSlotRef.current;
      if (!url || !slot || slot.childElementCount > 0 || cancelRef.current) return;

      setStatus('이미지 삽입 중…');
      setCursor('none');
      await sleep(600 + Math.random() * 500, () => cancelRef.current);

      const img = document.createElement('img');
      img.src = url;
      img.alt = '본문 삽입 이미지';
      img.decoding = 'async';
      img.className = 'mx-auto max-h-[360px] rounded border border-[#eee] object-contain shadow-sm my-4';
      slot.appendChild(img);

      setCursor('body');
      setStatus('본문 타이핑 중…');
      img.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      await sleep(400, () => cancelRef.current);
    };

    const typeChunk = async (node: Text | null, text: string) => {
      for (let i = 0; i < text.length; i++) {
        if (cancelRef.current) return;
        appendText(node, text[i]!);
        if (i % 5 === 0) {
          setCharCount(charCountRef.current);
          followCursor();
        }
        await sleep(charDelay(text[i]!), () => cancelRef.current);
      }
    };

    const pasteChunk = async (node: Text | null, text: string) => {
      if (cancelRef.current) return;
      appendText(node, text);
      setCharCount(charCountRef.current);
      followCursor();
      await sleep(300 + Math.random() * 400, () => cancelRef.current);
    };

    const run = async () => {
      const paras = splitNaverParagraphs(body, { contentType });
      const pasteAt = pickPasteIndices(paras.length);
      const titleNode = titleTextNodeRef.current;
      const bodyNode = bodyTextNodeRef.current;

      await typeChunk(titleNode, cleanTitle);

      if (cancelRef.current) return;
      await sleep(400 + Math.random() * 400, () => cancelRef.current);
      setCursor('body');
      setStatus('본문 타이핑 중…');

      for (let pi = 0; pi < paras.length; pi++) {
        if (cancelRef.current) return;
        const para = paras[pi]!;

        if (pi > 0) {
          appendText(bodyNode, '\n\n');
          setCharCount(charCountRef.current);
          followCursor();
          await sleep(500 + Math.random() * 700, () => cancelRef.current);
        }

        if (pasteAt.has(pi)) {
          await pasteChunk(bodyNode, para);
        } else {
          await typeChunk(bodyNode, para);
        }

        if (pi === 0) await insertImage();
      }

      if (cancelRef.current) return;

      if (contentType === 'B' && klingSlotRef.current) {
        const box = document.createElement('div');
        box.className =
          'mt-6 flex h-20 items-center justify-center rounded-md bg-black text-[22px] text-white';
        box.textContent = '▶ Kling 3.0 · 15초 Shorts 미리보기';
        klingSlotRef.current.appendChild(box);
      }

      setCursor('none');
      setStatus('타이핑 완료');
      setCharCount(charCountRef.current, true);
    };

    void run();
    return () => {
      cancelRef.current = true;
    };
  }, [cleanTitle, body, contentType, imageUrl]);

  return (
    <div className="overflow-hidden rounded-lg border border-[#ddd] bg-white shadow-lg">
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-[#f8f8f8] px-4 py-2">
        <span className="text-[13px] font-bold text-[#03c75a]">NAVER</span>
        <span className="text-[12px] text-[#666]">블로그 · 글쓰기</span>
        <span className="ml-auto rounded bg-[#fff8e6] px-2 py-0.5 text-[10px] text-[#b8860b]">
          검증 시뮬 · 실제 발행 없음
        </span>
      </div>

      <div className="border-b border-[#eee] bg-[#fafafa] px-4 py-1.5">
        <div className="flex gap-1">
          {['B', 'I', 'U', '사진'].map((t) => (
            <span
              key={t}
              className="rounded px-2 py-0.5 text-[11px] text-[#999]"
              style={{ fontFamily: 'Malgun Gothic, sans-serif' }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="border-b border-[#eee] px-4 py-3">
        <div
          className="min-h-[28px] text-[18px] font-semibold leading-snug text-[#111]"
          style={{ fontFamily: 'Malgun Gothic, sans-serif' }}
        >
          <span ref={titleHostRef} />
          <span ref={titleCursorRef} className="naver-editor-cursor" aria-hidden />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[min(520px,60vh)] min-h-[320px] overflow-y-auto overscroll-contain px-4 py-4"
      >
        <div
          className="whitespace-pre-wrap text-[14px] leading-[1.85] text-[#222]"
          style={{ fontFamily: 'Malgun Gothic, sans-serif' }}
        >
          <span ref={bodyHostRef} />
          <span ref={bodyCursorRef} className="naver-editor-cursor" style={{ visibility: 'hidden' }} aria-hidden />
        </div>

        <div ref={imageSlotRef} />
        <div ref={klingSlotRef} />
      </div>

      <div className="flex items-center justify-between border-t border-[#eee] bg-[#fafafa] px-4 py-2 text-[11px] text-[#888]">
        <span ref={statusRef}>제목 입력 중…</span>
        <span ref={countRef}>0자</span>
      </div>
    </div>
  );
});
