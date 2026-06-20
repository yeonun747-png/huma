'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatStorageBytes, formatVideoDurationSec, type VideoContentStorageFile } from '@/lib/video-content-storage';

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

const BASE_THUMB_WIDTH_PX = 96;
const COMPACT_THUMB_WIDTH_PX = 48;
const COMPACT_FILE_THRESHOLD = 10;
const DETAIL_BAR_HEIGHT_PX = 22;
const GRID_ROW_GAP_PX = 8;

function thumbHeightPx(widthPx: number): number {
  return Math.round(widthPx * (16 / 9));
}

function storageGridHeightPx(thumbWidthPx: number, rowCount: 1 | 2): number {
  const cardHeight = thumbHeightPx(thumbWidthPx) + DETAIL_BAR_HEIGHT_PX;
  if (rowCount === 1) return cardHeight;
  return cardHeight * 2 + GRID_ROW_GAP_PX;
}

function resolveThumbLayout(fileCount: number) {
  const compact = fileCount > COMPACT_FILE_THRESHOLD;
  const rowCount: 1 | 2 = compact ? 2 : 1;
  const thumbWidthPx = compact ? COMPACT_THUMB_WIDTH_PX : BASE_THUMB_WIDTH_PX;
  return {
    compact,
    rowCount,
    thumbWidthPx,
    sectionHeightPx: compact
      ? storageGridHeightPx(BASE_THUMB_WIDTH_PX, 2)
      : storageGridHeightPx(thumbWidthPx, rowCount),
  };
}

function StorageThumbnail({
  historyId,
  variant,
  durationSec,
  accountName,
  typeLabel,
  sizeLabel,
  compact,
  onClick,
}: {
  historyId: string;
  variant: 'subtitled' | 'source';
  durationSec: number | null;
  accountName: string;
  typeLabel: string;
  sizeLabel: string;
  compact?: boolean;
  onClick: () => void;
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
    <button
      type="button"
      className="group relative aspect-[9/16] w-full overflow-hidden rounded-md border border-huma-bdr bg-black"
      onClick={onClick}
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
      {durationLabel ? (
        <span className="pointer-events-none absolute right-1 top-1 z-10 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-white shadow-md">
          {durationLabel}
        </span>
      ) : null}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1.5 pb-1.5 ${
          compact ? 'pt-4' : 'pt-8'
        }`}
      >
        <p className="truncate text-[9px] font-semibold leading-tight text-white">
          {accountName} · {typeLabel} · {sizeLabel}
        </p>
      </div>
      <span
        className={`absolute inset-0 z-[1] flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100 ${
          compact ? 'text-[14px]' : 'text-[24px]'
        }`}
      >
        ▶
      </span>
    </button>
  );
}

export function VideoContentStorageFileGrid({
  files,
  accountLabel,
  onPlay,
  onOpenJob,
}: {
  files: VideoContentStorageFile[];
  accountLabel: (accountId: string) => string;
  onPlay: (file: VideoContentStorageFile) => void;
  onOpenJob: (historyId: string) => void;
}) {
  if (!files.length) {
    return (
      <p className="rounded border border-dashed border-huma-bdr py-8 text-center text-[11px] text-huma-t3">
        보관 중인 mp4 파일이 없습니다
      </p>
    );
  }

  const { compact, rowCount, thumbWidthPx, sectionHeightPx } = resolveThumbLayout(files.length);

  return (
    <div
      className="overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin]"
      style={{ height: sectionHeightPx, maxHeight: sectionHeightPx }}
    >
      <div
        className={`grid w-max grid-flow-col gap-x-2 gap-y-2 ${rowCount === 2 ? 'grid-rows-2' : 'grid-rows-1'}`}
        style={{ gridAutoColumns: `${thumbWidthPx}px` }}
      >
        {files.map((file) => (
          <div
            key={`${file.historyId}-${file.variant}`}
            className="flex flex-col overflow-hidden rounded-md border border-huma-bdr"
            style={{ width: thumbWidthPx }}
          >
            <StorageThumbnail
              historyId={file.historyId}
              variant={file.variant}
              durationSec={file.durationSec}
              accountName={accountLabel(file.account_id)}
              typeLabel={file.label}
              sizeLabel={formatStorageBytes(file.bytes)}
              compact={compact}
              onClick={() => onPlay(file)}
            />
            <button
              type="button"
              className={`w-full shrink-0 border-t border-huma-bdr bg-huma-bg3 text-huma-t3 hover:bg-huma-bg2 hover:text-huma-acc ${
                compact ? 'py-0.5 text-[8px]' : 'py-1 text-[9px]'
              }`}
              onClick={() => onOpenJob(file.historyId)}
            >
              작업 상세 →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
