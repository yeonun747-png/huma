'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatStorageBytes, type VideoContentStorageFile } from '@/lib/video-content-storage';

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
            <button
              type="button"
              className="mt-0.5 truncate text-left font-mono text-[11px] text-huma-acc hover:underline"
              onClick={() => {}}
            >
              {file.fileName}
            </button>
            <div className="text-[10px] text-huma-t3">
              {file.label} · {file.scenario_summary || '—'}
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
  onClick,
}: {
  historyId: string;
  variant: 'subtitled' | 'source';
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-[24px] text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
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

  return (
    <div className="grid max-h-[420px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {files.map((file) => (
        <div
          key={`${file.historyId}-${file.variant}`}
          className="rounded border border-huma-bdr bg-huma-bg3 p-2"
        >
          <StorageThumbnail historyId={file.historyId} variant={file.variant} onClick={() => onPlay(file)} />
          <button
            type="button"
            className="mt-1.5 block w-full truncate text-left font-mono text-[10px] text-huma-acc hover:underline"
            onClick={() => onPlay(file)}
          >
            {file.fileName}
          </button>
          <div className="mt-0.5 truncate text-[10px] font-semibold text-huma-t2">
            {accountLabel(file.account_id)}
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-1 text-[9px] text-huma-t4">
            <span className="rounded bg-huma-bg2 px-1 py-0.5">{file.label}</span>
            <span className="font-mono">{formatStorageBytes(file.bytes)}</span>
          </div>
          <button
            type="button"
            className="mt-1 text-[9px] text-huma-t3 hover:text-huma-acc"
            onClick={() => onOpenJob(file.historyId)}
          >
            작업 상세 →
          </button>
        </div>
      ))}
    </div>
  );
}
