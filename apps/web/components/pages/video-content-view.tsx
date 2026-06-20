'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HumaAccount, HumaVideoContentHistory } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm } from '@/lib/app-dialog';
import { useAuth } from '@/lib/auth-context';
import { getAccessibleBusinessUnits } from '@/lib/admin-scope';
import { WORKSPACES } from '@/lib/constants';
import { getLogSocket } from '@/lib/socket';
import {
  VIDEO_CONTENT_STATUS_LABEL,
  VIDEO_CONTENT_TAB_LABEL,
  countByVideoContentTab,
  filterByVideoContentTab,
  isDeletableVideoContent,
  isVideoProgressStatus,
  parseContiPreview,
  videoContentTabOf,
  type VideoContentTab,
} from '@/lib/video-content-status';
import {
  buildContiTargetOptions,
  resolveContiGenerationAccountId,
  videoContentDisplayName,
} from '@/lib/video-content-targets';
import { ShortformVideoModelSettings } from '@/components/settings/shortform-video-model-settings';
import { ContiPreview } from '@/components/video/conti-preview';
import { VideoContentStoragePanel } from '@/components/video/video-content-storage-panel';
import { MGrid, MPanel, MTag } from '@/components/mockup/primitives';

const PLATFORMS = [
  { key: 'youtube', label: 'YouTube', captionKey: 'caption_youtube' as const, uploadedKey: 'uploaded_youtube' as const },
  { key: 'tiktok', label: 'TikTok', captionKey: 'caption_tiktok' as const, uploadedKey: 'uploaded_tiktok' as const },
  { key: 'instagram', label: 'Instagram', captionKey: 'caption_instagram' as const, uploadedKey: 'uploaded_instagram' as const },
  { key: 'threads', label: 'Threads', captionKey: 'caption_threads' as const, uploadedKey: 'uploaded_threads' as const },
  { key: 'x', label: 'X', captionKey: 'caption_x' as const, uploadedKey: 'uploaded_x' as const },
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
      .fetchVideoContentBlob(id, variant === 'source' ? 'source' : undefined)
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

function ProgressWait({ status }: { status: string }) {
  const isConti = status === 'conti_generating';
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
    </div>
  );
}

function CompletedDetail({
  item,
  conti,
  accountName,
  deleting,
  reburning,
  videoRefreshKey,
  onReburn,
  onDelete,
  onRefresh,
}: {
  item: HumaVideoContentHistory;
  conti: ReturnType<typeof parseContiPreview>;
  accountName?: string;
  deleting: boolean;
  reburning: boolean;
  videoRefreshKey: number;
  onReburn: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState('youtube');
  const [showConti, setShowConti] = useState(false);
  const [videoVariant, setVideoVariant] = useState<'subtitled' | 'source'>('subtitled');
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
  const captionText = String(item[platform.captionKey] ?? '');
  const firstComment =
    tab === 'threads' ? item.first_comment_threads : tab === 'x' ? item.first_comment_x : null;

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    await appAlert('클립보드에 복사되었습니다');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-[13px] font-semibold text-huma-t">{accountName ?? item.account_id.slice(0, 8)}</div>
        {isDeletableVideoContent(item.status) ? (
          <button
            type="button"
            className="btn-ghost btn-sm text-huma-err"
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? '삭제 중…' : '작업 삭제'}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1">
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

      {videoUrl ? (
        <video src={videoUrl} controls className="max-h-[360px] w-full rounded bg-black" playsInline />
      ) : videoLoadError ? (
        <p className="rounded border border-huma-bdr bg-huma-bg2 px-3 py-6 text-center text-[11px] text-huma-t3">
          {videoVariant === 'source'
            ? '원본 파일 없음 (이전 작업이거나 삭제됨)'
            : '자막본 없음 — 원본에서 「자막만 다시 입히기」 가능'}
        </p>
      ) : (
        <p className="text-[11px] text-huma-t3">영상 로드 중…</p>
      )}

      <div className="flex flex-wrap gap-1">
        {PLATFORMS.map((p) => (
          <button key={p.key} type="button" className={`m-af ${tab === p.key ? 'e' : ''}`} onClick={() => setTab(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="rounded border border-huma-bdr bg-huma-bg2 p-2 text-[11px] whitespace-pre-wrap">
        {captionText || '(캡션 없음)'}
      </div>
      {firstComment ? (
        <div className="text-[10px] text-huma-t3">
          <span className="font-semibold">첫 댓글:</span> {firstComment}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {conti ? (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setShowConti((v) => !v)}>
            {showConti ? '콘티 닫기' : '콘티 보기'}
          </button>
        ) : null}
        <button
          type="button"
          className={`btn-ghost btn-sm ${reburning ? 'animate-pulse' : ''}`}
          disabled={!hasSource || reburning}
          title={hasSource ? undefined : '원본이 보관된 작업만 가능 (신규 생성분부터)'}
          onClick={onReburn}
        >
          {reburning ? '자막 입히는 중…' : '자막만 다시 입히기'}
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={videoVariant === 'source' ? !hasSource : !hasSubtitled}
          onClick={() => void api.downloadVideoContent(item.id, videoVariant === 'source' ? 'source' : undefined)}
        >
          {videoVariant === 'source' ? '원본 다운로드' : '자막본 다운로드'}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void copyText(captionText)}>
          캡션 복사
        </button>
        {firstComment ? (
          <button type="button" className="btn-ghost btn-sm" onClick={() => void copyText(firstComment)}>
            첫 댓글 복사
          </button>
        ) : null}
      </div>
      {showConti && conti ? (
        <div className="rounded border border-huma-bdr bg-huma-bg2 p-3">
          <ContiPreview conti={conti} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-huma-bdr pt-2">
        {PLATFORMS.map((p) => (
          <label key={p.key} className="flex items-center gap-1 text-[10px] text-huma-t2">
            <input
              type="checkbox"
              checked={Boolean(item[p.uploadedKey])}
              onChange={(e) =>
                void api.updateVideoContentUpload(item.id, { [`uploaded_${p.key}`]: e.target.checked }).then(onRefresh)
              }
            />
            {p.label} 업로드 완료
          </label>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({
  item,
  detail,
  accountName,
  loadingDetail,
  rendering,
  deleting,
  reburning,
  videoRefreshKey,
  onRender,
  onDelete,
  onReburn,
  onRefresh,
}: {
  item: HumaVideoContentHistory;
  detail: HumaVideoContentHistory | null;
  accountName?: string;
  loadingDetail: boolean;
  rendering: boolean;
  deleting: boolean;
  reburning: boolean;
  videoRefreshKey: number;
  onRender: () => void;
  onDelete: () => void;
  onReburn: () => void;
  onRefresh: () => void;
}) {
  const full = detail ?? item;
  const conti = parseContiPreview(full.conti_json);

  if (loadingDetail && !detail?.conti_json) {
    return <p className="text-[12px] text-huma-t3">콘티 불러오는 중…</p>;
  }

  if (item.status === 'completed') {
    return (
      <CompletedDetail
        item={full}
        conti={conti}
        accountName={accountName}
        deleting={deleting}
        reburning={reburning}
        videoRefreshKey={videoRefreshKey}
        onDelete={onDelete}
        onReburn={onReburn}
        onRefresh={onRefresh}
      />
    );
  }

  if (item.status === 'conti_generating' || item.status === 'rendering' || item.status === 'generating') {
    return <ProgressWait status={item.status} />;
  }

  const deletable = isDeletableVideoContent(item.status);

  if (item.status === 'failed') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-[12px] text-huma-err">{item.error_message ?? '생성 실패'}</p>
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
        {conti ? <ContiPreview conti={conti} /> : null}
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
          </div>
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
              className={`btn-primary btn-sm ${rendering ? 'animate-pulse' : ''}`}
              disabled={rendering}
              onClick={onRender}
            >
              {rendering ? '영상 생성 중…' : '숏폼 생성'}
            </button>
          ) : null}
        </div>
      </div>

      {item.status === 'on_hold' ? (
        <p className="rounded border border-huma-warn/30 bg-huma-bg3 px-3 py-2 text-[11px] text-huma-warn">
          {item.error_message ?? '프롬프트 길이 초과로 보류되었습니다.'} 콘티를 확인한 뒤 새 콘티를 생성하세요.
        </p>
      ) : null}

      {conti ? (
        <ContiPreview conti={conti} />
      ) : (
        <p className="text-[11px] text-huma-t3">콘티 데이터가 없습니다.</p>
      )}
    </div>
  );
}

export function VideoContentView() {
  const { admin } = useAuth();
  const units = useMemo(() => getAccessibleBusinessUnits(admin), [admin]);
  const [accounts, setAccounts] = useState<HumaAccount[]>([]);
  const [items, setItems] = useState<HumaVideoContentHistory[]>([]);
  const [filterWorkspace, setFilterWorkspace] = useState('');
  const [contiTarget, setContiTarget] = useState('');
  const [activeTab, setActiveTab] = useState<VideoContentTab>('review');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HumaVideoContentHistory | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creatingConti, setCreatingConti] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [reburning, setReburning] = useState(false);
  const [videoRefreshKey, setVideoRefreshKey] = useState(0);
  const [storageRefreshToken, setStorageRefreshToken] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const selectedStatusRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [accs, list] = await Promise.all([
      api.accounts(),
      api.videoContentList({
        workspace: filterWorkspace || undefined,
      }),
    ]);
    setAccounts(accs.filter((a) => a.account_type === 'posting'));
    setItems(list);
    return list;
  }, [filterWorkspace]);

  const hasProgressItems = useMemo(
    () => items.some((i) => isVideoProgressStatus(i.status)),
    [items],
  );

  useEffect(() => {
    void load().catch(() => {});
    const pollMs = hasProgressItems ? 2_000 : 10_000;
    const t = setInterval(() => void load().catch(() => {}), pollMs);
    return () => clearInterval(t);
  }, [load, hasProgressItems]);

  useEffect(() => {
    const socket = getLogSocket();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onLog = (payload: { message?: string }) => {
      const msg = payload?.message ?? '';
      if (!msg.includes('[video-content]')) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void load().catch(() => {});
      }, 250);
    };
    socket.connect();
    socket.on('log', onLog);
    socket.on('connect', () => void load().catch(() => {}));
    return () => {
      if (debounce) clearTimeout(debounce);
      socket.off('log', onLog);
    };
  }, [load]);

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
  }, [items, selectedId]);

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
    setStorageRefreshToken((t) => t + 1);
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
  }, [load, selectedId]);

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
      await load();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setDeleting(false);
    }
  };

  const handleRender = async () => {
    if (!selectedId) return;
    if (!(await appConfirm('검토한 콘티로 숏폼 영상을 제작합니다. 수 분 소요될 수 있습니다.'))) return;
    setRendering(true);
    try {
      await api.renderVideoContent(selectedId);
      setActiveTab('progress');
      const list = await load();
      const row = list.find((i) => i.id === selectedId);
      if (row) selectedStatusRef.current = row.status;
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '영상 제작 실패');
    } finally {
      setRendering(false);
    }
  };

  const handleReburn = async () => {
    if (!selectedId) return;
    if (
      !(await appConfirm(
        'EvoLink 재호출 없이 원본 영상에 자막만 다시 입힙니다.\n자막 스타일·타이밍이 새로 적용됩니다. (수십 초 소요)',
      ))
    ) {
      return;
    }
    setReburning(true);
    try {
      await api.reburnVideoSubtitles(selectedId);
      const row = await api.videoContentGet(selectedId);
      setDetail(row);
      await load();
      setVideoRefreshKey((k) => k + 1);
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '자막 재입히기 실패');
    } finally {
      setReburning(false);
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
                onClick={() => setActiveTab(tab)}
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
              value={filterWorkspace}
              onChange={(e) => setFilterWorkspace(e.target.value)}
            >
              <option value="">전체 워크스페이스</option>
              {WORKSPACES.filter((w) => units.includes(w.id)).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
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
                className={`btn-primary btn-sm w-full ${creatingConti ? 'animate-pulse' : ''}`}
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
                onClick={() => setActiveTab(tab)}
              >
                {VIDEO_CONTENT_TAB_LABEL[tab]}
                {tabCounts[tab] > 0 ? ` (${tabCounts[tab]})` : ''}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {filteredItems.length ? (
              <ul className="space-y-1">
                {filteredItems.map((item) => (
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
                        <MTag
                          tone={statusTone(item.status)}
                          className={`shrink-0 text-[9px] ${isVideoProgressStatus(item.status) ? 'animate-pulse' : ''}`}
                        >
                          {VIDEO_CONTENT_STATUS_LABEL[item.status] ?? item.status}
                        </MTag>
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
        </div>

        {/* 우: 상세 패널 */}
        <MPanel title="📄 작업 상세" className="m-panel-fill min-h-0 min-w-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {selectedItem ? (
              <DetailPanel
                item={selectedItem}
                detail={detail}
                accountName={videoContentDisplayName(selectedItem.account_id, accounts)}
                loadingDetail={loadingDetail}
                rendering={rendering}
                deleting={deleting}
                reburning={reburning}
                videoRefreshKey={videoRefreshKey}
                onRender={() => void handleRender()}
                onDelete={() => void handleDelete()}
                onReburn={() => void handleReburn()}
                onRefresh={() => void refreshSelectedDetail()}
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
        onOpenItem={(id) => {
          setSelectedId(id);
          setActiveTab('done');
        }}
      />
    </div>
  );
}
