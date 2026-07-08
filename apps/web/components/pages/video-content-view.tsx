'use client';

import Link from 'next/link';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BusinessUnit } from '@/lib/admin-scope';
import type { HumaAccount, HumaVideoContentHistory } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm, appToast } from '@/lib/app-dialog';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { getLogSocket } from '@/lib/socket';
import {
  VIDEO_CONTENT_STATUS_LABEL,
  VIDEO_CONTENT_TAB_LABEL,
  countByVideoContentTab,
  filterByVideoContentTab,
  formatElapsedDurationSec,
  elapsedSecSince,
  resolveVideoContentProgressSince,
  isDeletableVideoContent,
  isVideoProgressStatus,
  listPageSizeForVideoContentTab,
  listTotalPages,
  paginateList,
  parseContiPreview,
  canEditContiDialogues,
  videoContentTabOf,
  type VideoContentTab,
} from '@/lib/video-content-status';
import {
  buildContiTargetOptions,
  resolveContiGenerationAccountId,
  videoContentDisplayName,
} from '@/lib/video-content-targets';
import {
  parseVideoContentProgressStage,
  resolveVideoContentProgressHistoryId,
} from '@/lib/video-content-progress';
import { ContiPreview, type ShotDialogueDraft } from '@/components/video/conti-preview';
import { SubtitleEditPanel, type ShotSubtitleDraft } from '@/components/video/subtitle-edit-panel';
import { SubtitlePreviewOverlay, type SubtitlePreviewEvent } from '@/components/video/subtitle-preview-overlay';
import { ShortformVideoModelSettings } from '@/components/settings/shortform-video-model-settings';
import { VideoContentHumorBadge } from '@/components/video/video-content-humor-badge';
import { VideoContentStoragePanel } from '@/components/video/video-content-storage-panel';
import { VIDEO_DETAIL_ACTION_BTN, VIDEO_PLATFORM_TAB_BTN, VIDEO_PRIMARY_BTN } from '@/components/video/video-content-ui';
import { MGrid, MPanel, MTag } from '@/components/mockup/primitives';
import { SocialPlatformIcon, type SocialPlatformKey } from '@/components/video/social-platform-icon';
import { useShellViewActive } from '@/components/dashboard/shell-view-active';
import { resolveYoutubeShortsCaptionFields } from '@/lib/video-content-youtube-caption';

const NarrationScriptView = lazy(() =>
  import('@/components/narration/narration-script-view').then((m) => ({ default: m.NarrationScriptView })),
);

type ContentTrack = 'story' | 'narration';

function defaultContentTrack(unit: BusinessUnit): ContentTrack {
  return unit === 'fortune82' ? 'narration' : 'story';
}

function VideoContentTrackBar({
  track,
  storyDisabled,
  onTrack,
}: {
  track: ContentTrack;
  storyDisabled: boolean;
  onTrack: (t: ContentTrack) => void;
}) {
  return (
    <div className="flex shrink-0 gap-2 border-b border-huma-bdr pb-2">
      <button
        type="button"
        className={`rounded px-3 py-1.5 text-[12px] ${track === 'story' && !storyDisabled ? 'bg-huma-accent/20 text-huma-accent' : 'text-huma-t3'} ${storyDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
        disabled={storyDisabled}
        onClick={() => onTrack('story')}
      >
        스토리형 · 클링3
      </button>
      <button
        type="button"
        className={`rounded px-3 py-1.5 text-[12px] ${track === 'narration' || storyDisabled ? 'bg-huma-accent/20 text-huma-accent' : 'text-huma-t3'}`}
        onClick={() => onTrack('narration')}
      >
        나레이션 · 브루
      </button>
    </div>
  );
}

const PLATFORMS: Array<{
  key: SocialPlatformKey;
  label: string;
  captionKey:
    | 'caption_youtube'
    | 'caption_tiktok'
    | 'caption_instagram'
    | 'caption_threads'
    | 'caption_x';
}> = [
  { key: 'youtube', label: 'YouTube', captionKey: 'caption_youtube' },
  { key: 'tiktok', label: 'TikTok', captionKey: 'caption_tiktok' },
  { key: 'instagram', label: 'Instagram', captionKey: 'caption_instagram' },
  { key: 'threads', label: 'Threads', captionKey: 'caption_threads' },
  { key: 'x', label: 'X', captionKey: 'caption_x' },
];

function useVideoBlob(
  id: string | null,
  enabled: boolean,
  variant: 'subtitled' | 'source' = 'subtitled',
  refreshKey = 0,
) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!id || !enabled) return;
    let revoked: string | null = null;
    setLoadError(false);
    setUrl(null);
    void api
      .fetchVideoContentBlob(id, variant === 'source' ? 'source' : undefined, refreshKey)
      .then((blob) => {
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      })
      .catch(() => setLoadError(true));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
      setUrl(null);
    };
  }, [id, enabled, variant, refreshKey]);
  return { url, loadError };
}

function statusTone(status: string): 'ok' | 'warn' | 'err' | 'idle' {
  if (status === 'completed') return 'ok';
  if (status === 'conti_ready') return 'idle';
  if (status === 'failed' || status === 'on_hold') return 'err';
  return 'warn';
}

function useElapsedSec(sinceIso: string | null | undefined, active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!sinceIso || !active) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(elapsedSecSince(sinceIso));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sinceIso, active]);
  return elapsed;
}

function ProgressWait({
  status,
  sinceIso,
  stageLabel,
  stopping,
  onCancel,
}: {
  status: string;
  sinceIso?: string;
  stageLabel?: string | null;
  stopping?: boolean;
  onCancel?: () => void;
}) {
  const isConti = status === 'conti_generating';
  const elapsedSec = useElapsedSec(sinceIso, true);
  const defaultStage =
    status === 'conti_generating'
      ? '콘티 파이프라인 준비 중…'
      : status === 'rendering' || status === 'generating'
        ? 'EvoLink 영상 제작 중…'
        : null;
  const currentStage = stageLabel?.trim() || defaultStage;
  const elapsedLabel = isConti ? '콘티 작성 경과' : '작업 경과';
  return (
    <div className="py-12 text-center">
      <div className="mx-auto mb-4 h-1.5 max-w-[240px] overflow-hidden rounded-full bg-huma-bg3">
        <div className="vc-progress-indeterminate h-full w-2/5 rounded-full bg-huma-acc" />
      </div>
      <div className="animate-pulse text-[14px] font-semibold text-huma-t2">
        {VIDEO_CONTENT_STATUS_LABEL[status] ?? status}
      </div>
      <p className="mt-2 font-mono text-[11px] text-huma-t3">
        {isConti
          ? 'Sonnet이 콘티를 작성 중입니다. 완료되면 「검토 대기」 탭으로 이동합니다.'
          : 'EvoLink 영상 제작·자막·캡션 생성 중입니다.'}
      </p>
      {sinceIso ? (
        <p className="mt-3 font-mono text-[12px] font-semibold text-huma-acc">
          {elapsedLabel} {formatElapsedDurationSec(elapsedSec)}
        </p>
      ) : null}
      {currentStage ? (
        <p className="mt-2 px-4 font-mono text-[11px] leading-relaxed text-huma-t2">{currentStage}</p>
      ) : null}
      {onCancel ? (
        <button
          type="button"
          className="btn-ghost btn-sm mt-5 border border-huma-warn/40 text-huma-warn hover:bg-huma-warn/10"
          disabled={stopping}
          onClick={onCancel}
        >
          {stopping ? '중지 중…' : '작업 중지'}
        </button>
      ) : null}
    </div>
  );
}

export type ReburnDialoguePatch = {
  shotNumber: number;
  dialogue: string;
  action: string;
  startSec?: number;
  endSec?: number;
};

export type ReburnOptions = {
  skipConfirm?: boolean;
  dialogues?: ReburnDialoguePatch[];
};

function CompletedDetail({
  item,
  conti,
  accountName,
  reburning,
  restoring,
  rerendering,
  deleting,
  videoRefreshKey,
  onReburn,
  onRestoreSubtitles,
  onRerender,
  onDelete,
  onRefresh,
}: {
  item: HumaVideoContentHistory;
  conti: ReturnType<typeof parseContiPreview>;
  accountName?: string;
  reburning: boolean;
  restoring: boolean;
  rerendering: boolean;
  deleting: boolean;
  videoRefreshKey: number;
  onReburn: (opts?: ReburnOptions) => Promise<void>;
  onRestoreSubtitles: () => Promise<void>;
  onRerender: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<SocialPlatformKey>('youtube');
  const [videoVariant, setVideoVariant] = useState<'subtitled' | 'source'>('subtitled');
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [previewEvents, setPreviewEvents] = useState<SubtitlePreviewEvent[]>([]);
  const [videoCurrentTimeSec, setVideoCurrentTimeSec] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastPreviewTickRef = useRef(0);
  const { url: videoUrl, loadError: videoLoadError } = useVideoBlob(
    item.id,
    item.status === 'completed' &&
      (videoVariant === 'subtitled' ? Boolean(item.video_file_path) : Boolean(item.source_video_path)),
    videoVariant,
    videoRefreshKey,
  );
  const hasSubtitled = Boolean(item.video_file_path);
  const hasSource = Boolean(item.source_video_path);
  const platform = PLATFORMS.find((p) => p.key === tab)!;
  const youtubeCaption =
    tab === 'youtube' ? resolveYoutubeShortsCaptionFields(item) : null;
  const captionText =
    tab === 'youtube'
      ? ''
      : String(item[platform.captionKey] ?? '');
  const firstComment =
    tab === 'threads' ? item.first_comment_threads : tab === 'x' ? item.first_comment_x : null;
  const renderCount = Number(item.conti_json?.videoRenderCount ?? 1);
  const reburnCount = Number(item.conti_json?.subtitleReburnCount ?? 0);
  const canRestore = Boolean(
    item.conti_json?.lastSubtitleArchive &&
      typeof item.conti_json.lastSubtitleArchive === 'object',
  );

  const persistDrafts = useCallback(
    async (drafts: ShotSubtitleDraft[]) => {
      try {
        await api.updateVideoContentShotDialogues(
          item.id,
          drafts.map((d) => ({
            shotNumber: d.shotNumber,
            dialogue: d.dialogue,
            action: d.action,
            startSec: d.startSec,
            endSec: d.endSec,
          })),
        );
        appToast('멘트·구간을 저장했습니다');
        await onRefresh();
      } catch (e) {
        await appAlert(e instanceof Error ? e.message : '저장 실패');
        throw e;
      }
    },
    [item.id, onRefresh],
  );

  const saveAndApply = useCallback(
    async (drafts: ShotSubtitleDraft[]) => {
      try {
        await onReburn({
          skipConfirm: true,
          dialogues: drafts.map((d) => ({
            shotNumber: d.shotNumber,
            dialogue: d.dialogue.replace(/\r\n/g, '\n'),
            action: d.action,
            startSec: d.startSec,
            endSec: d.endSec,
          })),
        });
        appToast('자막이 적용되었습니다');
        await onRefresh();
      } catch (e) {
        await appAlert(e instanceof Error ? e.message : '자막 적용 실패');
        throw e;
      }
    },
    [onReburn, onRefresh],
  );

  const seekVideo = useCallback((sec: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, sec);
    void el.play().catch(() => {});
  }, []);

  const subtitlePanelRef = useRef<HTMLDivElement>(null);

  const handlePreviewEventsChange = useCallback((events: SubtitlePreviewEvent[]) => {
    setPreviewEvents(events);
  }, []);

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    appToast('클립보드에 복사되었습니다');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-huma-t">
            {accountName ?? item.account_id.slice(0, 8)}
          </span>
          <VideoContentHumorBadge humor={item.self_assessed_humor} />
          {renderCount > 1 ? (
            <span className="font-mono text-[10px] text-huma-t3">영상 {renderCount}회차</span>
          ) : null}
          {reburnCount > 0 ? (
            <span className="font-mono text-[10px] text-huma-t3">자막 수정 {reburnCount}회</span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm shrink-0 text-huma-err"
          disabled={deleting || rerendering || reburning || restoring}
          onClick={onDelete}
        >
          {deleting ? '삭제 중…' : '삭제'}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            type="button"
            className={`m-af ${videoVariant === 'subtitled' ? 'e' : ''}`}
            disabled={!hasSubtitled}
            onClick={() => setVideoVariant('subtitled')}
          >
            자막본
          </button>
          <button
            type="button"
            className={`m-af ${videoVariant === 'source' ? 'e' : ''}`}
            disabled={!hasSource}
            onClick={() => setVideoVariant('source')}
          >
            원본
          </button>
        </div>
        <button
          type="button"
          className={`${VIDEO_DETAIL_ACTION_BTN} ${rerendering ? 'animate-pulse' : ''}`}
          disabled={rerendering || reburning || restoring || deleting}
          title="Kling 영상을 처음부터 다시 생성합니다"
          onClick={onRerender}
        >
          {rerendering ? '🔄 재생성 중…' : '🔄 영상 재생성(비용발생)'}
        </button>
      </div>

      <div className="relative mx-auto w-full max-w-[240px] sm:mx-0">
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className={`max-h-[380px] w-full rounded bg-black ${reburning ? 'opacity-50' : ''}`}
              playsInline
              onTimeUpdate={(e) => {
                if (!previewEnabled) return;
                const now = performance.now();
                if (now - lastPreviewTickRef.current < 120) return;
                lastPreviewTickRef.current = now;
                setVideoCurrentTimeSec(e.currentTarget.currentTime);
              }}
            />
            <SubtitlePreviewOverlay
              events={previewEvents}
              currentTimeSec={videoCurrentTimeSec}
              active={previewEnabled && videoVariant === 'subtitled'}
            />
            {reburning ? (
              <div className="absolute inset-0 flex items-center justify-center rounded bg-black/40">
                <span className="animate-pulse text-[11px] font-semibold text-white">자막 입히는 중…</span>
              </div>
            ) : null}
          </>
        ) : videoLoadError ? (
          <p className="rounded border border-huma-bdr bg-huma-bg2 px-3 py-8 text-center text-[11px] text-huma-t3">
            {videoVariant === 'source'
              ? '원본 파일 없음 (이전 작업이거나 삭제됨)'
              : '자막본 없음 — 아래 「자막만 다시 입히기(무료)」 사용'}
          </p>
        ) : (
          <p className="text-[11px] text-huma-t3">영상 로드 중…</p>
        )}
      </div>

      {conti ? (
        <div ref={subtitlePanelRef}>
          <SubtitleEditPanel
          historyId={item.id}
          conti={conti}
          hasSource={hasSource}
          reburning={reburning}
          restoring={restoring}
          reburnCount={reburnCount}
          canRestore={canRestore}
          previewEnabled={previewEnabled}
          onPreviewEnabledChange={setPreviewEnabled}
          onPreviewEventsChange={handlePreviewEventsChange}
          onSeek={seekVideo}
          onSaveOnly={persistDrafts}
          onSaveAndApply={saveAndApply}
          onRestore={onRestoreSubtitles}
          onApplyWithoutSave={(opts) => onReburn({ skipConfirm: opts?.skipConfirm })}
        />
        </div>
      ) : (
        <p className="rounded-lg border border-huma-bdr bg-huma-bg2 px-3 py-4 text-[11px] text-huma-t3">
          콘티 데이터가 없어 자막 수정 패널을 표시할 수 없습니다.
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${VIDEO_PLATFORM_TAB_BTN} ${tab === p.key ? 'e' : ''}`}
            title={p.label}
            onClick={() => setTab(p.key)}
          >
            <span className="inline-flex items-center gap-1">
              <SocialPlatformIcon platform={p.key} size={13} />
              {p.label}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded border border-huma-bdr bg-huma-bg2 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap">
        {tab === 'youtube' ? (
          <>
            <p className="mb-1 text-[10px] font-semibold text-huma-t2">제목 + 해시태그</p>
            <p>{youtubeCaption?.title || '(제목 없음)'}</p>
            <p className="mb-1 mt-3 border-t border-huma-bdr pt-2 text-[10px] font-semibold text-huma-t2">
              설명
            </p>
            <p>{youtubeCaption?.description || '(설명 없음)'}</p>
          </>
        ) : (
          captionText || '(캡션 없음)'
        )}
        {firstComment ? (
          <p className="mt-2 border-t border-huma-bdr pt-2 text-[10px] text-huma-t3">
            <span className="font-semibold text-huma-t2">첫 댓글</span>
            <br />
            {firstComment}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={VIDEO_DETAIL_ACTION_BTN}
          disabled={videoVariant === 'source' ? !hasSource : !hasSubtitled}
          onClick={() => void api.downloadVideoContent(item.id, videoVariant === 'source' ? 'source' : undefined)}
        >
          {videoVariant === 'source' ? '⬇️ 원본 다운로드' : '⬇️ 자막본 다운로드'}
        </button>
        {tab === 'youtube' ? (
          <>
            <button
              type="button"
              className={VIDEO_DETAIL_ACTION_BTN}
              disabled={!youtubeCaption?.title}
              onClick={() => void copyText(youtubeCaption?.title ?? '')}
            >
              📋 제목+해시태그 복사
            </button>
            <button
              type="button"
              className={VIDEO_DETAIL_ACTION_BTN}
              disabled={!youtubeCaption?.description}
              onClick={() => void copyText(youtubeCaption?.description ?? '')}
            >
              📋 설명 복사
            </button>
          </>
        ) : (
          <button type="button" className={VIDEO_DETAIL_ACTION_BTN} onClick={() => void copyText(captionText)}>
            📋 캡션 복사
          </button>
        )}
        {firstComment ? (
          <button type="button" className={VIDEO_DETAIL_ACTION_BTN} onClick={() => void copyText(firstComment)}>
            첫 댓글 복사
          </button>
        ) : null}
      </div>
    </div>
  );
}

function contiDurationLabel(item: HumaVideoContentHistory): string | null {
  if (item.conti_generation_sec != null && item.conti_generation_sec > 0) {
    return formatElapsedDurationSec(item.conti_generation_sec);
  }
  return null;
}

function DetailPanel({
  item,
  detail,
  accountName,
  loadingDetail,
  renderingStarting,
  deleting,
  reburning,
  restoring,
  rerendering,
  videoRefreshKey,
  onRender,
  onDelete,
  onReburn,
  onRestoreSubtitles,
  onRerender,
  onRefresh,
  progressStage,
  stopping,
  onCancel,
}: {
  item: HumaVideoContentHistory;
  detail: HumaVideoContentHistory | null;
  accountName?: string;
  loadingDetail: boolean;
  renderingStarting: boolean;
  deleting: boolean;
  reburning: boolean;
  restoring: boolean;
  rerendering: boolean;
  stopping: boolean;
  videoRefreshKey: number;
  onRender: () => void;
  onDelete: () => void;
  onReburn: (opts?: ReburnOptions) => Promise<void>;
  onRestoreSubtitles: () => Promise<void>;
  onRerender: () => void;
  onRefresh: () => void;
  progressStage?: string | null;
  onCancel?: () => void;
}) {
  const full = detail ?? item;
  const conti = parseContiPreview(full.conti_json);
  const contiDuration = contiDurationLabel(full);

  const saveShotDialogues = useCallback(
    async (dialogues: ShotDialogueDraft[]) => {
      try {
        await api.updateVideoContentShotDialogues(full.id, dialogues);
        await appAlert('액션/멘트를 저장했습니다');
        onRefresh();
      } catch (e) {
        await appAlert(e instanceof Error ? e.message : '액션/멘트 저장 실패');
        throw e;
      }
    },
    [full.id, onRefresh],
  );

  if (loadingDetail && !detail?.conti_json) {
    return <p className="text-[12px] text-huma-t3">콘티 불러오는 중…</p>;
  }

  if (item.status === 'completed') {
    return (
      <CompletedDetail
        item={full}
        conti={conti}
        accountName={accountName}
        reburning={reburning}
        restoring={restoring}
        rerendering={rerendering}
        deleting={deleting}
        videoRefreshKey={videoRefreshKey}
        onReburn={onReburn}
        onRestoreSubtitles={onRestoreSubtitles}
        onRerender={onRerender}
        onDelete={onDelete}
        onRefresh={onRefresh}
      />
    );
  }

  if (item.status === 'conti_generating' || item.status === 'rendering' || item.status === 'generating') {
    return (
      <ProgressWait
        status={item.status}
        sinceIso={resolveVideoContentProgressSince(full)}
        stageLabel={progressStage}
        stopping={stopping}
        onCancel={onCancel}
      />
    );
  }

  const deletable = isDeletableVideoContent(item.status);

  if (item.status === 'failed') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-[12px] text-huma-err">{item.error_message ?? '생성 실패'}</p>
          {contiDuration ? (
            <span className="font-mono text-[10px] text-huma-t3">콘티 작성 {contiDuration}</span>
          ) : null}
          {deletable ? (
            <button
              type="button"
              className="btn-ghost btn-sm text-huma-err"
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          ) : null}
        </div>
        {conti ? (
          <ContiPreview
            conti={conti}
            editable={canEditContiDialogues(item.status)}
            onSaveDialogues={saveShotDialogues}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-huma-t">{accountName ?? item.account_id.slice(0, 8)}</div>
          <div className="mt-0.5 text-[10px] text-huma-t3">
            {item.relationship_axis} · {item.emotion_curve} · {item.hook_type} · {item.duration}s
            {item.similarity_score != null ? ` · 유사도 ${Number(item.similarity_score).toFixed(3)}` : ''}
            {item.retry_count_for_humor ? ` · 유머 재시도 ${item.retry_count_for_humor}회` : ''}
            {contiDuration ? ` · 콘티 작성 ${contiDuration}` : ''}
          </div>
          <VideoContentHumorBadge humor={item.self_assessed_humor} className="mt-1" />
        </div>
        <div className="flex flex-wrap gap-2">
          {deletable ? (
            <button
              type="button"
              className="btn-ghost btn-sm text-huma-err"
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          ) : null}
          {item.status === 'conti_ready' ? (
            <button
              type="button"
              className={`${VIDEO_PRIMARY_BTN} ${renderingStarting ? 'animate-pulse' : ''}`}
              disabled={renderingStarting}
              onClick={onRender}
            >
              {renderingStarting ? '요청 중…' : '숏폼 생성'}
            </button>
          ) : null}
        </div>
      </div>

      {item.status === 'on_hold' ? (
        <p className="rounded border border-huma-warn/30 bg-huma-bg3 px-3 py-2 text-[11px] text-huma-warn">
          {item.error_message ?? '프롬프트 길이 초과로 보류되었습니다.'} 콘티를 확인한 뒤 새 콘티를 생성하세요.
        </p>
      ) : null}
      {item.status === 'conti_ready' && item.error_message ? (
        <p className="rounded border border-huma-warn/30 bg-huma-bg3 px-3 py-2 text-[11px] text-huma-warn">
          {item.error_message} 「숏폼 생성」으로 다시 시도할 수 있습니다.
        </p>
      ) : null}

      {conti ? (
        <ContiPreview
          conti={conti}
          editable={canEditContiDialogues(item.status)}
          onSaveDialogues={saveShotDialogues}
        />
      ) : (
        <p className="text-[11px] text-huma-t3">콘티 데이터가 없습니다.</p>
      )}
    </div>
  );
}

export function VideoContentStoryView() {
  const shellActive = useShellViewActive();
  const { workspace: filterWorkspace } = useWorkspace();
  const [accounts, setAccounts] = useState<HumaAccount[]>([]);
  const [items, setItems] = useState<HumaVideoContentHistory[]>([]);
  const [contiTarget, setContiTarget] = useState('');
  const [activeTab, setActiveTab] = useState<VideoContentTab>('review');
  const [listPage, setListPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HumaVideoContentHistory | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creatingConti, setCreatingConti] = useState(false);
  const [renderingIds, setRenderingIds] = useState<Set<string>>(() => new Set());
  const [rerenderingIds, setRerenderingIds] = useState<Set<string>>(() => new Set());
  const [reburning, setReburning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [videoRefreshKey, setVideoRefreshKey] = useState(0);
  const [storageRefreshToken, setStorageRefreshToken] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progressStageById, setProgressStageById] = useState<Record<string, string>>({});
  const [listLoading, setListLoading] = useState(true);
  const selectedStatusRef = useRef<string | null>(null);
  const hadProgressRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  const filterWorkspaceRef = useRef(filterWorkspace);
  selectedIdRef.current = selectedId;
  itemsRef.current = items;
  filterWorkspaceRef.current = filterWorkspace;

  const load = useCallback(async (opts?: { force?: boolean; silent?: boolean }) => {
    const ws = filterWorkspace;
    if (!opts?.silent) setListLoading(true);
    try {
      const [accs, list] = await Promise.all([
        api.accounts({ force: opts?.force }),
        api.videoContentList({ workspace: ws }, { force: opts?.force }),
      ]);
      if (ws !== filterWorkspaceRef.current) return list;
      setAccounts(accs.filter((a) => a.account_type === 'posting'));
      setItems(list);
      return list;
    } catch {
      if (ws === filterWorkspaceRef.current) {
        setAccounts([]);
        setItems([]);
      }
      return [];
    } finally {
      if (ws === filterWorkspaceRef.current && !opts?.silent) {
        setListLoading(false);
      }
    }
  }, [filterWorkspace]);

  useEffect(() => {
    setItems([]);
    setAccounts([]);
    setSelectedId(null);
    setDetail(null);
    setProgressStageById({});
    setLoadingDetail(false);
    setListLoading(true);
    setContiTarget('');
  }, [filterWorkspace]);

  const hasProgressItems = useMemo(
    () => items.some((i) => isVideoProgressStatus(i.status)),
    [items],
  );

  const bumpStorageRefresh = useCallback(() => {
    setStorageRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (hadProgressRef.current && !hasProgressItems) {
      bumpStorageRefresh();
    }
    hadProgressRef.current = hasProgressItems;
  }, [hasProgressItems, bumpStorageRefresh]);

  useEffect(() => {
    if (!shellActive) return;
    void load({ force: true }).catch(() => {});
    const pollMs = hasProgressItems ? 2_000 : 10_000;
    const t = setInterval(() => void load({ force: true, silent: true }).catch(() => {}), pollMs);
    return () => clearInterval(t);
  }, [load, hasProgressItems, shellActive]);

  useEffect(() => {
    const socket = getLogSocket();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onLog = (payload: { message?: string; account_id?: string; metadata?: Record<string, unknown> }) => {
      const msg = payload?.message ?? '';
      if (!msg.includes('[video-content]')) return;

      const parsed = parseVideoContentProgressStage(payload);
      if (parsed) {
        const historyId = resolveVideoContentProgressHistoryId({
          payload,
          parsed,
          items: itemsRef.current,
          selectedId: selectedIdRef.current,
        });
        if (historyId) {
          setProgressStageById((prev) => ({ ...prev, [historyId]: parsed.stage }));
        }
      }

      if (msg.includes('생성 완료') || msg.includes('자막 재입히기 완료')) {
        bumpStorageRefresh();
      }
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void load({ silent: true }).catch(() => {});
      }, 250);
    };
    socket.connect();
    socket.on('log', onLog);
    socket.on('connect', () => void load({ silent: true }).catch(() => {}));
    return () => {
      if (debounce) clearTimeout(debounce);
      socket.off('log', onLog);
    };
  }, [load, bumpStorageRefresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
      setSelectedId(id);
      const item = items.find((i) => i.id === id);
      if (item) setActiveTab(videoContentTabOf(item.status));
    }
  }, [items]);

  useEffect(() => {
    if (!selectedId) {
      selectedStatusRef.current = null;
      return;
    }
    setLoadingDetail(true);
    void api
      .videoContentGet(selectedId)
      .then((row) => {
        setDetail(row);
        selectedStatusRef.current = row.status;
      })
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const item = items.find((i) => i.id === selectedId);
    if (!item) return;

    const prev = selectedStatusRef.current;
    if (prev && prev !== item.status) {
      setActiveTab(videoContentTabOf(item.status));
      if (item.status === 'completed') {
        bumpStorageRefresh();
      }
      void api
        .videoContentGet(selectedId)
        .then((row) => {
          setDetail(row);
          selectedStatusRef.current = row.status;
        })
        .catch(() => {});
    } else if (!prev) {
      selectedStatusRef.current = item.status;
    }
  }, [items, selectedId, bumpStorageRefresh]);

  const contiTargetOptions = useMemo(
    () => buildContiTargetOptions(accounts, filterWorkspace),
    [accounts, filterWorkspace],
  );

  useEffect(() => {
    if (contiTarget && contiTargetOptions.some((o) => o.value === contiTarget)) return;
    setContiTarget(contiTargetOptions[0]?.value ?? '');
  }, [contiTargetOptions, contiTarget]);

  const tabCounts = useMemo(() => countByVideoContentTab(items), [items]);
  const filteredItems = useMemo(() => filterByVideoContentTab(items, activeTab), [items, activeTab]);
  const listPageSize = listPageSizeForVideoContentTab(activeTab);
  const listTotal = filteredItems.length;
  const listPageCount = listTotalPages(listTotal, listPageSize);
  const pagedItems = useMemo(
    () => paginateList(filteredItems, listPage, listPageSize),
    [filteredItems, listPage, listPageSize],
  );
  const showListPagination = listTotal > listPageSize;

  useEffect(() => {
    setListPage(1);
  }, [activeTab, filterWorkspace]);

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount);
  }, [listPage, listPageCount]);

  useEffect(() => {
    if (selectedId && items.some((i) => i.id === selectedId)) return;
    if (!filteredItems.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId(filteredItems[0]!.id);
  }, [filteredItems, selectedId, items]);

  const refreshSelectedDetail = useCallback(async () => {
    const list = await load();
    bumpStorageRefresh();
    if (!selectedId) return list;
    try {
      const row = await api.videoContentGet(selectedId);
      setDetail(row);
      setVideoRefreshKey((k) => k + 1);
    } catch {
      const row = list.find((i) => i.id === selectedId);
      if (row) setDetail(row as HumaVideoContentHistory);
    }
    return list;
  }, [load, selectedId, bumpStorageRefresh]);

  const selectedItem = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;

  const handleCreateConti = async () => {
    const accountId = resolveContiGenerationAccountId(contiTarget, accounts);
    if (!accountId) {
      await appAlert('콘티를 생성할 대상을 선택하세요.');
      return;
    }
    const label =
      contiTargetOptions.find((o) => o.value === contiTarget)?.label ??
      videoContentDisplayName(accountId, accounts);
    if (!(await appConfirm(`${label}(으)로 콘티 1건을 생성합니다.`))) return;
    setCreatingConti(true);
    try {
      await api.generateConti(accountId);
      const list = await load();
      const newest = [...list]
        .filter((i) => i.status === 'conti_generating')
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      if (newest) setSelectedId(newest.id);
      setActiveTab('progress');
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '콘티 생성 실패');
    } finally {
      setCreatingConti(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !selectedItem) return;
    if (!isDeletableVideoContent(selectedItem.status)) return;
    const name = videoContentDisplayName(selectedItem.account_id, accounts);
    const label = VIDEO_CONTENT_STATUS_LABEL[selectedItem.status] ?? selectedItem.status;
    if (
      !(await appConfirm(
        `${name} · ${label}\n\n정말 삭제하시겠습니까?\n콘티·영상 파일이 모두 제거되며 되돌릴 수 없습니다.`,
        { title: '작업 삭제', destructive: true, confirmLabel: '삭제' },
      ))
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteVideoContent(selectedId);
      setSelectedId(null);
      setDetail(null);
      bumpStorageRefresh();
      await load();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setDeleting(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedId || !selectedItem) return;
    if (!isVideoProgressStatus(selectedItem.status)) return;
    const name = videoContentDisplayName(selectedItem.account_id, accounts);
    const label = VIDEO_CONTENT_STATUS_LABEL[selectedItem.status] ?? selectedItem.status;
    if (
      !(await appConfirm(
        `${name} · ${label}\n\n진행 중인 작업을 중지할까요?\n서버에 남아 있는 작업은 곧 멈추고, 「실패·보류」 탭으로 이동합니다.`,
        { title: '작업 중지', destructive: true, confirmLabel: '중지' },
      ))
    ) {
      return;
    }
    setStopping(true);
    try {
      await api.cancelVideoContent(selectedId);
      setProgressStageById((prev) => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
      await load();
      setActiveTab('failed');
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '작업 중지 실패');
    } finally {
      setStopping(false);
    }
  };

  const handleRender = async (opts?: { rerender?: boolean }) => {
    if (!selectedId) return;
    const isRerender = opts?.rerender ?? selectedItem?.status === 'completed';
    const confirmMsg = isRerender
      ? '같은 콘티로 Kling 3 영상을 다시 만듭니다.\n\n· 성공: 기존 영상은 서버 보관 폴더로 옮기고, 새 영상으로 교체 (업로드 체크 초기화)\n· 실패: 기존 완료 영상은 그대로 유지\n\n수 분 소요될 수 있습니다.'
      : '검토한 콘티로 숏폼 영상을 제작합니다. 수 분 소요될 수 있습니다.';
    if (!(await appConfirm(confirmMsg))) return;
    const markRendering = isRerender ? setRerenderingIds : setRenderingIds;
    markRendering((prev) => new Set(prev).add(selectedId));
    try {
      await api.renderVideoContent(selectedId);
      setActiveTab('progress');
      const renderStartedAt = new Date().toISOString();
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId
            ? {
                ...i,
                status: 'rendering',
                error_message: null,
                progress_since_at: renderStartedAt,
                conti_json: { ...(i.conti_json ?? {}), videoRenderStartedAt: renderStartedAt },
              }
            : i,
        ),
      );
      selectedStatusRef.current = 'rendering';
      const list = await load();
      const row = list.find((i) => i.id === selectedId);
      if (row) selectedStatusRef.current = row.status;
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '영상 제작 실패');
    } finally {
      const clearRendering = isRerender ? setRerenderingIds : setRenderingIds;
      clearRendering((prev) => {
        const next = new Set(prev);
        next.delete(selectedId);
        return next;
      });
    }
  };

  const handleReburn = async (opts?: ReburnOptions) => {
    if (!selectedId) return;
    if (
      !opts?.skipConfirm &&
      !(await appConfirm(
        'EvoLink 재호출 없이 원본 영상에 자막만 다시 입힙니다.\n자막 스타일·타이밍이 새로 적용됩니다. (수십 초 소요)',
      ))
    ) {
      return;
    }
    setReburning(true);
    try {
      await api.reburnVideoSubtitles(selectedId, opts?.dialogues);
      const row = await api.videoContentGet(selectedId);
      setDetail(row);
      await load({ silent: true });
      setVideoRefreshKey((k) => k + 1);
      if (!opts?.skipConfirm) {
        appToast('자막이 적용되었습니다');
      }
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '자막 재입히기 실패');
      throw e;
    } finally {
      setReburning(false);
    }
  };

  const handleRestoreSubtitles = async () => {
    if (!selectedId) return;
    if (!(await appConfirm('직전 자막본으로 되돌립니다. 계속할까요?'))) return;
    setRestoring(true);
    try {
      const row = await api.restoreVideoSubtitles(selectedId);
      setDetail(row);
      await load({ silent: true });
      setVideoRefreshKey((k) => k + 1);
      appToast('이전 자막본으로 복원했습니다');
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '자막 복원 실패');
      throw e;
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-4 p-1">
      <p className="text-[12px] leading-relaxed text-huma-t3">
        ① 생성 대상 선택 → <strong className="text-huma-t2">콘티 생성</strong> (Sonnet) → ② 콘티 검토 →{' '}
        <strong className="text-huma-t2">숏폼 생성</strong> (EvoLink). 네이버 포스팅은{' '}
        <Link href="/queue" className="text-huma-acc hover:underline">
          포스팅 큐 관리
        </Link>
        를 사용하세요.
      </p>

      <MGrid cols={2}>
        <ShortformVideoModelSettings />
        <MPanel title="📊 작업 현황">
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(VIDEO_CONTENT_TAB_LABEL) as VideoContentTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`rounded border px-1 py-1.5 text-center transition-colors ${
                  activeTab === tab ? 'border-huma-acc bg-huma-glow' : 'border-huma-bdr bg-huma-bg2'
                }`}
                onClick={() => {
                  setActiveTab(tab);
                  setListPage(1);
                }}
              >
                <div className="text-[15px] font-bold leading-tight text-huma-t">{tabCounts[tab]}</div>
                <div className="text-[8.5px] leading-tight text-huma-t3">{VIDEO_CONTENT_TAB_LABEL[tab]}</div>
              </button>
            ))}
          </div>
        </MPanel>
      </MGrid>

      <div className="flex min-h-[520px] items-stretch gap-3">
        {/* 좌: 작업 목록 */}
        <div className="flex min-h-0 w-[280px] shrink-0 flex-col rounded-lg border border-huma-bdr bg-huma-bg2">
          <div className="space-y-2 border-b border-huma-bdr p-3">
            <select
              className="m-model-select w-full"
              value={contiTarget}
              onChange={(e) => setContiTarget(e.target.value)}
            >
              <option value="">콘티 생성 대상</option>
              {contiTargetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className={`${VIDEO_PRIMARY_BTN} w-full ${creatingConti ? 'animate-pulse' : ''}`}
                disabled={!contiTarget || creatingConti}
                onClick={() => void handleCreateConti()}
              >
                {creatingConti ? '콘티 생성 중…' : '콘티 생성'}
              </button>
            </div>
          </div>

          <div className="flex border-b border-huma-bdr">
            {(Object.keys(VIDEO_CONTENT_TAB_LABEL) as VideoContentTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`flex-1 px-1 py-2 text-[9px] ${activeTab === tab ? 'bg-huma-glow text-huma-acc' : 'text-huma-t3'}`}
                onClick={() => {
                  setActiveTab(tab);
                  setListPage(1);
                }}
              >
                {VIDEO_CONTENT_TAB_LABEL[tab]}
                {tabCounts[tab] > 0 ? ` (${tabCounts[tab]})` : ''}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {listLoading ? (
              <p className="py-8 text-center text-[11px] text-huma-t3 animate-pulse">불러오는 중…</p>
            ) : pagedItems.length ? (
              <ul className="space-y-1">
                {pagedItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`w-full rounded-md border px-2 py-2 text-left transition-colors ${
                        selectedId === item.id
                          ? 'border-huma-acc bg-huma-glow'
                          : 'border-transparent hover:border-huma-bdr hover:bg-huma-bg3'
                      }`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-[11px] font-semibold text-huma-t">
                          {videoContentDisplayName(item.account_id, accounts)}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {Number(item.conti_json?.subtitleReburnCount ?? 0) > 0 ? (
                            <span className="font-mono text-[8px] text-huma-t4">
                              자막{Number(item.conti_json?.subtitleReburnCount)}
                            </span>
                          ) : null}
                          <VideoContentHumorBadge humor={item.self_assessed_humor} />
                          <MTag
                            tone={statusTone(item.status)}
                            className={`text-[9px] ${isVideoProgressStatus(item.status) ? 'animate-pulse' : ''}`}
                          >
                            {VIDEO_CONTENT_STATUS_LABEL[item.status] ?? item.status}
                          </MTag>
                        </div>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-huma-t3">
                        {item.scenario_summary || '—'}
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] text-huma-t4">
                        {new Date(item.created_at).toLocaleString('ko-KR', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-[11px] text-huma-t3">
                {activeTab === 'review' ? '검토할 콘티가 없습니다' : '항목 없음'}
              </p>
            )}
            </div>
            <div className="flex shrink-0 items-center justify-center gap-2 border-t border-huma-bdr px-2 py-2">
              {showListPagination ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost btn-sm px-2"
                    disabled={listPage <= 1}
                    onClick={() => setListPage((p) => Math.max(1, p - 1))}
                  >
                    ◀
                  </button>
                  <span className="font-mono text-[10px] text-huma-t3">
                    {listPage} / {listPageCount}
                    <span className="ml-1 text-huma-t4">· {listTotal}건</span>
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm px-2"
                    disabled={listPage >= listPageCount}
                    onClick={() => setListPage((p) => Math.min(listPageCount, p + 1))}
                  >
                    ▶
                  </button>
                </>
              ) : (
                <span className="font-mono text-[10px] text-huma-t4">
                  {listTotal > 0 ? `전체 ${listTotal}건` : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 우: 상세 패널 */}
        <MPanel title="📄 작업 상세" className="m-panel-fill min-h-0 min-w-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listLoading ? (
              <div className="py-16 text-center text-[12px] text-huma-t3 animate-pulse">불러오는 중…</div>
            ) : selectedItem ? (
              <DetailPanel
                item={selectedItem}
                detail={detail}
                accountName={videoContentDisplayName(selectedItem.account_id, accounts)}
                loadingDetail={loadingDetail}
                renderingStarting={selectedId ? renderingIds.has(selectedId) : false}
                rerendering={selectedId ? rerenderingIds.has(selectedId) : false}
                deleting={deleting}
                reburning={reburning}
                restoring={restoring}
                stopping={stopping}
                videoRefreshKey={videoRefreshKey}
                onRender={() => void handleRender()}
                onDelete={() => void handleDelete()}
                onReburn={handleReburn}
                onRestoreSubtitles={handleRestoreSubtitles}
                onRerender={() => void handleRender({ rerender: true })}
                onRefresh={() => void refreshSelectedDetail()}
                onCancel={() => void handleCancel()}
                progressStage={selectedId ? progressStageById[selectedId] : null}
              />
            ) : (
              <div className="py-16 text-center text-[12px] text-huma-t3">
                왼쪽에서 작업을 선택하거나
                <br />
                생성 대상을 고른 뒤 「콘티 생성」을 누르세요.
              </div>
            )}
          </div>
        </MPanel>
      </div>

      <VideoContentStoragePanel
        filterWorkspace={filterWorkspace}
        accounts={accounts}
        refreshToken={storageRefreshToken}
        onRefresh={() => void refreshSelectedDetail()}
        onListRefresh={async () => {
          const list = await load();
          if (selectedId && !list.some((i) => i.id === selectedId)) {
            setSelectedId(null);
            setDetail(null);
          }
        }}
        onOpenItem={(id) => {
          setSelectedId(id);
          setActiveTab('done');
        }}
      />
    </div>
  );
}

/** 숏폼 영상 관리 — 스토리형·나레이션 탭 */
export function VideoContentView() {
  const { businessUnit } = useWorkspace();
  const [track, setTrack] = useState<ContentTrack>(() => defaultContentTrack(businessUnit));

  useEffect(() => {
    setTrack(defaultContentTrack(businessUnit));
  }, [businessUnit]);

  const storyDisabled = businessUnit === 'fortune82';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <VideoContentTrackBar track={track} storyDisabled={storyDisabled} onTrack={setTrack} />
      <Suspense
        fallback={<div className="py-16 text-center text-[12px] text-huma-t3 animate-pulse">불러오는 중…</div>}
      >
        {track === 'narration' || storyDisabled ? (
          <NarrationScriptView service={businessUnit === 'fortune82' ? 'fortune82' : 'yeonun'} />
        ) : (
          <VideoContentStoryView />
        )}
      </Suspense>
    </div>
  );
}
