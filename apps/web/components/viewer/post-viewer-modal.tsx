'use client';

import { useEffect, useState } from 'react';
import { WS_LABEL } from '@/lib/constants';
import {
  mergePostViewerTemplate,
  PostViewerArticle,
  type PostViewerOverrides,
} from '@/lib/post-viewer-templates';

export type PostViewerModalProps = {
  open: boolean;
  onClose: () => void;
  isLive?: boolean;
} & PostViewerOverrides;

export function PostViewerModal({
  open,
  title,
  workspace,
  isLive = false,
  content,
  resultUrl,
  completedAt,
  imageUrl,
  videoUrl,
  hashtags,
  onClose,
}: PostViewerModalProps) {
  const [progress, setProgress] = useState(18);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !isLive) {
      setProgress(18);
      return;
    }
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 94) return 12 + Math.random() * 8;
        return Math.min(94, p + 4 + Math.random() * 10);
      });
    }, 800);
    return () => clearInterval(id);
  }, [open, isLive]);

  if (!open) return null;

  const overrides: PostViewerOverrides = {
    title,
    workspace,
    content,
    resultUrl,
    completedAt,
    imageUrl,
    videoUrl,
    hashtags,
  };
  const template = mergePostViewerTemplate(overrides);
  const wsLabel = WS_LABEL[workspace] ?? workspace;

  return (
    <div className="m-modal-bg open z-[500]" role="presentation" onClick={onClose}>
      <div
        className="m-modal m-modal-post-viewer max-h-[90vh] w-[min(720px,96vw)] overflow-hidden"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-modal-t flex items-center justify-between gap-2">
          <span className="truncate">🔍 포스팅 전체조감 — {title}</span>
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mb-2 font-mono text-[10.5px] text-huma-t3">
          {wsLabel} · HTML 미리보기
          {isLive ? <span className="ml-2 text-huma-warn">· LIVE 진행 중</span> : null}
          {resultUrl && !isLive ? <span className="ml-2 text-huma-ok">· 발행 완료</span> : null}
        </div>
        {isLive && (
          <div className="mb-3">
            <div className="mb-1 flex justify-between font-mono text-[10px] text-huma-t3">
              <span>생성 진행</span>
              <span className="text-huma-warn">{Math.round(progress)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-huma-bg4">
              <div
                className="h-full rounded-full bg-huma-acc transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-huma-bdr bg-white p-4 text-[#1a1a1a]">
          <PostViewerArticle template={template} isLive={isLive} overrides={overrides} />
        </div>
      </div>
    </div>
  );
}
