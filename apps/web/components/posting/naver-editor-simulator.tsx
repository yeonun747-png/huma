'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ContentType } from '@huma/shared';
import { sanitizeBlogPostForNaver, splitNaverParagraphs } from '@/lib/naver-post-sanitize';

function sleep(ms: number, cancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const id = window.setTimeout(() => {
      resolve();
    }, ms);
    if (cancelled()) {
      window.clearTimeout(id);
      resolve();
    }
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

  const [imageVisible, setImageVisible] = useState(false);
  const [typingDone, setTypingDone] = useState(false);

  const titleTextRef = useRef<HTMLSpanElement>(null);
  const bodyTextRef = useRef<HTMLSpanElement>(null);
  const titleCursorRef = useRef<HTMLSpanElement>(null);
  const bodyCursorRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const imageUrlRef = useRef(imageUrl);
  const imageInsertedRef = useRef(false);

  useEffect(() => {
    imageUrlRef.current = imageUrl;
  }, [imageUrl]);

  const setCursor = (target: 'title' | 'body' | 'none') => {
    if (titleCursorRef.current) {
      titleCursorRef.current.style.display = target === 'title' ? 'inline-block' : 'none';
    }
    if (bodyCursorRef.current) {
      bodyCursorRef.current.style.display = target === 'body' ? 'inline-block' : 'none';
    }
  };

  const setStatus = (label: string) => {
    if (statusRef.current) statusRef.current.textContent = label;
  };

  const setCharCount = (n: number, done = false) => {
    if (countRef.current) {
      countRef.current.textContent = `${n.toLocaleString()}자${done ? ' · 복붙 30% / 타이핑 70% 시뮬' : ''}`;
    }
  };

  const scrollToBottom = () => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  useEffect(() => {
    cancelRef.current = false;
    imageInsertedRef.current = false;
    setImageVisible(false);
    setTypingDone(false);
    if (titleTextRef.current) titleTextRef.current.textContent = '';
    if (bodyTextRef.current) bodyTextRef.current.textContent = '';
    setCursor('title');
    setStatus('제목 입력 중…');
    setCharCount(0);

    const insertImage = async () => {
      if (imageInsertedRef.current || !imageUrlRef.current || cancelRef.current) return;
      imageInsertedRef.current = true;
      setStatus('이미지 삽입 중…');
      setCursor('none');
      await sleep(600 + Math.random() * 500, () => cancelRef.current);
      setImageVisible(true);
      setCursor('body');
      setStatus('본문 타이핑 중…');
      scrollToBottom();
      await sleep(400, () => cancelRef.current);
    };

    const run = async () => {
      const paras = splitNaverParagraphs(body, { contentType });
      const pasteAt = pickPasteIndices(paras.length);

      for (let i = 0; i < cleanTitle.length; i++) {
        if (cancelRef.current) return;
        if (titleTextRef.current) {
          titleTextRef.current.textContent = cleanTitle.slice(0, i + 1);
        }
        await sleep(charDelay(cleanTitle[i]!), () => cancelRef.current);
      }

      if (cancelRef.current) return;
      await sleep(400 + Math.random() * 400, () => cancelRef.current);
      setCursor('body');
      setStatus('본문 타이핑 중…');

      let assembled = '';

      for (let pi = 0; pi < paras.length; pi++) {
        if (cancelRef.current) return;
        const para = paras[pi]!;

        if (pi > 0) {
          assembled += '\n\n';
          if (bodyTextRef.current) bodyTextRef.current.textContent = assembled;
          setCharCount(assembled.length);
          scrollToBottom();
          await sleep(500 + Math.random() * 700, () => cancelRef.current);
        }

        if (pasteAt.has(pi)) {
          assembled += para;
          if (bodyTextRef.current) bodyTextRef.current.textContent = assembled;
          setCharCount(assembled.length);
          scrollToBottom();
          await sleep(300 + Math.random() * 400, () => cancelRef.current);
        } else {
          for (let ci = 0; ci < para.length; ci++) {
            if (cancelRef.current) return;
            assembled += para[ci];
            if (bodyTextRef.current) {
              bodyTextRef.current.textContent = assembled;
            }
            if (ci % 4 === 0) {
              setCharCount(assembled.length);
              scrollToBottom();
            }
            await sleep(charDelay(para[ci]!), () => cancelRef.current);
          }
          setCharCount(assembled.length);
          scrollToBottom();
        }

        if (pi === 0) {
          await insertImage();
        }
      }

      if (cancelRef.current) return;
      setCursor('none');
      setStatus('타이핑 완료');
      setTypingDone(true);
      setCharCount(assembled.length, true);
    };

    void run();
    return () => {
      cancelRef.current = true;
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
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
          <span ref={titleTextRef} />
          <span ref={titleCursorRef} className="naver-editor-cursor" aria-hidden />
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[min(520px,60vh)] min-h-[320px] overflow-y-auto overscroll-contain px-4 py-4"
        style={{ contain: 'layout style paint' }}
      >
        <div
          className="whitespace-pre-wrap text-[14px] leading-[1.85] text-[#222]"
          style={{ fontFamily: 'Malgun Gothic, sans-serif' }}
        >
          <span ref={bodyTextRef} />
          <span ref={bodyCursorRef} className="naver-editor-cursor" style={{ display: 'none' }} aria-hidden />
        </div>

        {imageVisible && imageUrlRef.current && (
          <div className="my-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrlRef.current}
              alt="본문 삽입 이미지"
              className="mx-auto max-h-[360px] rounded border border-[#eee] object-contain shadow-sm"
              decoding="async"
            />
          </div>
        )}

        {contentType === 'B' && typingDone && (
          <div className="mt-6 flex h-20 items-center justify-center rounded-md bg-black text-[22px] text-white">
            ▶ Kling 3.0 · 15초 Shorts 미리보기
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[#eee] bg-[#fafafa] px-4 py-2 text-[11px] text-[#888]">
        <span ref={statusRef}>제목 입력 중…</span>
        <span ref={countRef}>0자</span>
      </div>
    </div>
  );
});
