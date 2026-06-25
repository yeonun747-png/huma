'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatStorageBytes, formatVideoDurationSec, type VideoContentStorageFile, type VideoContentStoragePair } from '@/lib/video-content-storage';
import {
  resolveStorageGridLayout,
  STORAGE_SCROLLBAR_GUTTER_PX,
  STORAGE_THUMB_WIDTH_PX,
  storageGridHeightPx,
  storagePairColumnWidthPx,
} from './video-content-storage-layout';

export function VideoContentPlaybackModal({
  file,
  accountLabel,
  onClose,
}: {
  file: VideoContentStorageFile | null;
  accountLabel: string;
  onClose: () => void;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!file) {
      setVideoUrl(null);
      setError(false);
      return;
    }
    let revoked: string | null = null;
    setLoading(true);
    setError(false);
    setVideoUrl(null);
    void api
      .fetchVideoContentBlob(file.historyId, file.variant === 'source' ? 'source' : undefined)
      .then((blob) => {
        revoked = URL.createObjectURL(blob);
        setVideoUrl(revoked);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
      setVideoUrl(null);
    };
  }, [file]);

  if (!file) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-huma-bdr bg-huma-bg2 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-huma-bdr px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-huma-t">{accountLabel}</div>
            <div className="text-[10px] text-huma-t3">
              {file.label} · {formatStorageBytes(file.bytes)}
              {file.scenario_summary ? ` · ${file.scenario_summary}` : ''}
            </div>
          </div>
          <button type="button" className="btn-ghost btn-sm shrink-0" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2">
          {loading ? (
            <p className="text-[12px] text-huma-t3">영상 로드 중…</p>
          ) : error ? (
            <p className="text-[12px] text-huma-err">재생할 수 없습니다</p>
          ) : videoUrl ? (
            <video
              src={videoUrl}
              controls
              autoPlay
              playsInline
              className="max-h-[70vh] w-full rounded"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StorageThumbnail({
  historyId,
  variant,
  durationSec,
  accountName,
  typeLabel,
  sizeLabel,
  deleting,
  onClick,
  onDelete,
}: {
  historyId: string;
  variant: 'subtitled' | 'source';
  durationSec: number | null;
  accountName: string;
  typeLabel: string;
  sizeLabel: string;
  deleting?: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const durationLabel = formatVideoDurationSec(durationSec);

  useEffect(() => {
    let revoked: string | null = null;
    setFailed(false);
    setUrl(null);
    void api
      .fetchVideoContentThumbnail(historyId, variant)
      .then((blob) => {
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      })
      .catch(() => setFailed(true));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [historyId, variant]);

  return (
    <div className="group relative aspect-[9/16] w-full overflow-hidden rounded-md border border-huma-bdr bg-black">
      <button
        type="button"
        className="absolute inset-0 z-[2] w-full"
        onClick={onClick}
        aria-label={`${typeLabel} 재생`}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover transition group-hover:opacity-90" />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center text-[10px] text-huma-t4 ${failed ? '' : 'animate-pulse bg-huma-bg3'}`}
          >
            {failed ? '썸네일 없음' : '…'}
          </div>
        )}
        <span className="absolute inset-0 z-[1] flex items-center justify-center bg-black/0 text-[24px] text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
          ▶
        </span>
      </button>
      <button
        type="button"
        className="absolute left-1 top-1 z-20 rounded bg-huma-err px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white shadow-md hover:brightness-90 disabled:opacity-50"
        disabled={deleting}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        {deleting ? '…' : '삭제'}
      </button>
      {durationLabel ? (
        <span className="pointer-events-none absolute right-1 top-1 z-10 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-white shadow-md">
          {durationLabel}
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1.5 pb-1.5 pt-8">
        <p className="truncate text-[9px] font-semibold leading-tight text-white">
          {accountName} · {typeLabel} · {sizeLabel}
        </p>
      </div>
    </div>
  );
}

export function VideoContentStorageFileGrid({
  pairs,
  accountLabel,
  deletingKey,
  onPlay,
  onOpenJob,
  onDeleteFile,
}: {
  pairs: VideoContentStoragePair[];
  accountLabel: (accountId: string) => string;
  deletingKey?: string | null;
  onPlay: (file: VideoContentStorageFile) => void;
  onOpenJob: (historyId: string) => void;
  onDeleteFile: (file: VideoContentStorageFile) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => resolveStorageGridLayout(0, pairs.length));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      setLayout(resolveStorageGridLayout(el.clientWidth, pairs.length));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pairs.length]);

  if (!pairs.length) {
    return (
      <p className="rounded border border-dashed border-huma-bdr py-8 text-center text-[11px] text-huma-t3">
        보관 중인 mp4 파일이 없습니다
      </p>
    );
  }

  const thumbWidthPx = STORAGE_THUMB_WIDTH_PX;
  const { rowCount, needsScroll, pairStack } = layout;
  const pairColumnWidthPx = storagePairColumnWidthPx(thumbWidthPx, pairStack);
  const gridHeightPx = storageGridHeightPx(thumbWidthPx, rowCount, pairStack);
  const scrollPaddingBottom = needsScroll ? STORAGE_SCROLLBAR_GUTTER_PX : 0;
  const pairThumbLayoutClass =
    pairStack === 'col' ? 'flex flex-col gap-1' : 'grid grid-cols-2 gap-1';

  return (
    <div
      ref={scrollRef}
      className={`storage-file-grid-scroll overflow-y-hidden ${needsScroll ? 'overflow-x-auto' : 'overflow-x-hidden'}`}
      style={{
        minHeight: gridHeightPx + scrollPaddingBottom,
        paddingBottom: scrollPaddingBottom,
      }}
    >
      <div
        className={`grid w-max grid-flow-col gap-x-2 gap-y-2 ${rowCount === 2 ? 'grid-rows-2' : 'grid-rows-1'}`}
        style={{ gridAutoColumns: `${pairColumnWidthPx}px`, height: gridHeightPx }}
      >
        {pairs.map((pair) => {
          const files = [pair.subtitled, pair.source].filter(
            (f): f is VideoContentStorageFile => f != null,
          );
          const singleFile = files.length === 1;
          return (
            <div
              key={pair.historyId}
              className="flex flex-col overflow-hidden rounded-md border border-huma-bdr"
              style={{ width: pairColumnWidthPx }}
            >
              <div className={singleFile ? '' : pairThumbLayoutClass}>
                {files.map((file) => (
                  <StorageThumbnail
                    key={file.variant}
                    historyId={file.historyId}
                    variant={file.variant}
                    durationSec={file.durationSec}
                    accountName={accountLabel(file.account_id)}
                    typeLabel={file.label}
                    sizeLabel={formatStorageBytes(file.bytes)}
                    deleting={deletingKey === file.historyId}
                    onClick={() => onPlay(file)}
                    onDelete={() => onDeleteFile(file)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="w-full shrink-0 border-t border-huma-bdr bg-huma-bg3 py-1 text-[9px] text-huma-t3 hover:bg-huma-bg2 hover:text-huma-acc"
                onClick={() => onOpenJob(pair.historyId)}
              >
                작업 상세 →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
