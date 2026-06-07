'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

export type NaverSimTarget =
  | 'publish-top'
  | 'toolbar-photo'
  | 'toolbar-video'
  | 'toolbar-link'
  | 'link-dialog-input'
  | 'link-dialog-confirm'
  | 'title'
  | 'body'
  | 'category'
  | 'tag-input'
  | 'publish-confirm';

export type NaverEditorChromeHandle = {
  getTarget: (id: NaverSimTarget) => HTMLElement | null;
  getScrollRoot: () => HTMLElement | null;
};

const TOOLBAR_ROW1 = [
  { key: 'photo', label: '사진', target: 'toolbar-photo' as const },
  { key: 'mybox', label: 'MYBOX' },
  { key: 'sticker', label: '스티커' },
  { key: 'video', label: '동영상', target: 'toolbar-video' as const },
  { key: 'quote', label: '인용구' },
  { key: 'hr', label: '구분선' },
  { key: 'link', label: '링크', target: 'toolbar-link' as const },
  { key: 'file', label: '파일' },
  { key: 'schedule', label: '일정' },
  { key: 'code', label: '소스코드' },
  { key: 'table', label: '표' },
  { key: 'formula', label: '수식' },
];

type Props = {
  titleSlot: React.ReactNode;
  bodySlot: React.ReactNode;
  imageSlot?: React.ReactNode;
  linkSlot?: React.ReactNode;
  publishOpen: boolean;
  linkDialogOpen: boolean;
  activeToolbar?: NaverSimTarget | null;
  tagPreview?: string;
  categoryLabel?: string;
  viewportLabel?: string;
};

export const NaverSmartEditorChrome = forwardRef<NaverEditorChromeHandle, Props>(
  function NaverSmartEditorChrome(
    {
      titleSlot,
      bodySlot,
      imageSlot,
      linkSlot,
      publishOpen,
      linkDialogOpen,
      activeToolbar,
      tagPreview,
      categoryLabel = '포스팅',
      viewportLabel = '1920×1080',
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      getTarget(id: NaverSimTarget) {
        return rootRef.current?.querySelector<HTMLElement>(`[data-naver-target="${id}"]`) ?? null;
      },
      getScrollRoot() {
        return scrollRef.current;
      },
    }));

    return (
      <div ref={rootRef} className="naver-se-root flex min-h-0 flex-1 flex-col bg-[#ececec]">
        {/* 상단 NAVER 블로그 헤더 */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#e0e0e0] bg-white px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-black tracking-tight text-[#03c75a]">N</span>
            <span className="text-[13px] font-semibold text-[#333]">blog</span>
            <span className="ml-3 hidden text-[10px] text-[#999] sm:inline">Playwright viewport · {viewportLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="naver-se-btn-save rounded border border-[#ddd] px-3 py-1.5 text-[12px] text-[#555]">
              저장 <span className="ml-1 text-[#999]">1</span>
            </button>
            <button
              type="button"
              data-naver-target="publish-top"
              className={`naver-se-btn-publish rounded px-4 py-1.5 text-[13px] font-semibold text-white ${
                activeToolbar === 'publish-top' ? 'ring-2 ring-[#02964a] ring-offset-1' : ''
              }`}
            >
              발행
            </button>
          </div>
        </div>

        {/* 툴바 1행 — 삽입 */}
        <div className="shrink-0 border-b border-[#ebebeb] bg-white px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-0.5">
            {TOOLBAR_ROW1.map((item) => (
              <button
                key={item.key}
                type="button"
                data-naver-target={item.target}
                className={`naver-se-tb1 rounded px-2 py-1 text-[11px] text-[#444] hover:bg-[#f5f5f5] ${
                  item.target && activeToolbar === item.target ? 'naver-se-tb-active' : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 툴바 2행 — 서식 (Playwright 미사용 · 표시만) */}
        <div className="shrink-0 border-b border-[#ebebeb] bg-[#fafafa] px-3 py-1 opacity-80">
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-[#555]">
            <span className="rounded border border-[#ddd] bg-white px-2 py-0.5">본문</span>
            <span className="rounded border border-[#ddd] bg-white px-2 py-0.5">나눔고딕</span>
            <span className="min-w-[36px] rounded border border-[#ddd] bg-white px-2 py-0.5 text-center">15</span>
            <span className="mx-1 text-[#ddd]">|</span>
            <span className="min-w-[28px] rounded border border-[#ddd] bg-white px-2 py-0.5 text-center font-bold">B</span>
            <span className="min-w-[28px] rounded border border-[#ddd] bg-white px-2 py-0.5 text-center italic">I</span>
            <span className="ml-auto text-[10px] text-[#aaa]">맞춤법</span>
          </div>
        </div>

        {/* 본문 캔버스 + 발행 패널 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div ref={scrollRef} className="naver-se-scroll h-full overflow-y-auto px-[12%] py-6">
            <div className="mx-auto max-w-[720px] rounded-sm bg-white px-8 pb-16 pt-6 shadow-sm">
              <div
                data-naver-target="title"
                className="border-b border-[#eee] pb-3"
              >
                <div className="text-[10px] text-[#aaa]">제목 · #subjectTextBox</div>
                <div className="naver-editor-title-text min-h-[44px] py-1 text-[22px] font-bold leading-snug text-[#111]">
                  {titleSlot}
                </div>
              </div>

              <div
                data-naver-target="body"
                className="mt-4"
              >
                <div className="mb-1 text-[10px] text-[#aaa]">본문 · .se-content</div>
                <div className="naver-editor-body-text min-h-[360px] whitespace-pre-wrap text-[15px] leading-[2] text-[#222]">
                  {bodySlot}
                </div>
                {imageSlot}
                {linkSlot}
              </div>
            </div>
          </div>

          {linkDialogOpen && (
            <div className="naver-se-link-dialog absolute left-1/2 top-[28%] z-30 w-[min(100%,360px)] -translate-x-1/2 rounded-lg border border-[#ddd] bg-white p-4 shadow-2xl">
              <div className="mb-2 text-[13px] font-semibold text-[#333]">링크 삽입</div>
              <div
                data-naver-target="link-dialog-input"
                className="mb-3 min-h-[36px] rounded border border-[#03c75a]/40 bg-[#fafafa] px-3 py-2 font-mono text-[12px] text-[#333]"
              />
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded border border-[#ddd] px-3 py-1.5 text-[12px] text-[#666]">
                  취소
                </button>
                <button
                  type="button"
                  data-naver-target="link-dialog-confirm"
                  className="rounded bg-[#03c75a] px-4 py-1.5 text-[12px] font-semibold text-white"
                >
                  확인
                </button>
              </div>
            </div>
          )}

          {/* 2차 발행 패널 (스크린샷 2) */}
          {publishOpen && (
            <div className="naver-se-publish-panel absolute right-[8%] top-4 z-20 w-[min(100%,320px)] rounded-lg border border-[#e5e5e5] bg-white p-4 shadow-xl">
              <div className="mb-3 text-[13px] font-semibold text-[#333]">발행 설정</div>

              <div className="mb-3">
                <div className="mb-1 text-[11px] text-[#888]">카테고리</div>
                <button
                  type="button"
                  data-naver-target="category"
                  className="flex w-full items-center justify-between rounded border border-[#ddd] bg-white px-3 py-2 text-left text-[12px] text-[#333]"
                >
                  <span>{categoryLabel}</span>
                  <span className="text-[#aaa]">▾</span>
                </button>
              </div>

              <div className="mb-3">
                <div className="mb-1 text-[11px] text-[#888]">주제</div>
                <div className="text-[12px] text-[#666]">주제 선택 안함 &gt;</div>
              </div>

              <div className="mb-3">
                <div className="mb-1 text-[11px] font-medium text-[#555]">공개 설정</div>
                <div className="flex flex-wrap gap-2 text-[11px] text-[#666]">
                  <label className="flex items-center gap-1">
                    <input type="radio" readOnly checked /> 전체공개
                  </label>
                  <label className="flex items-center gap-1 opacity-60">
                    <input type="radio" readOnly /> 이웃공개
                  </label>
                </div>
              </div>

              <div className="mb-3">
                <div className="mb-1 text-[11px] font-medium text-[#555]">태그 편집</div>
                <div
                  data-naver-target="tag-input"
                  className="min-h-[36px] rounded border border-[#ddd] bg-[#fafafa] px-3 py-2 text-[12px] text-[#333]"
                >
                  {tagPreview || <span className="text-[#bbb]">#태그 입력 (최대 30개)</span>}
                </div>
              </div>

              <div className="mb-4 text-[11px] text-[#888]">
                <label className="flex items-center gap-1">
                  <input type="radio" readOnly checked /> 현재
                </label>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  data-naver-target="publish-confirm"
                  className={`flex items-center gap-1 rounded bg-[#03c75a] px-5 py-2 text-[13px] font-semibold text-white ${
                    activeToolbar === 'publish-confirm' ? 'ring-2 ring-[#02964a] ring-offset-1' : ''
                  }`}
                >
                  <span>✓</span> 발행
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);
