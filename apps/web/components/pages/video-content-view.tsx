'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaAccount, HumaVideoContentHistory } from '@huma/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getAccessibleBusinessUnits } from '@/lib/admin-scope';
import { WORKSPACES } from '@/lib/constants';
import {
  VIDEO_CONTENT_STATUS_LABEL,
  VIDEO_CONTENT_TAB_LABEL,
  countByVideoContentTab,
  filterByVideoContentTab,
  parseContiPreview,
  videoContentTabOf,
  type VideoContentTab,
} from '@/lib/video-content-status';
import { ShortformVideoModelSettings } from '@/components/settings/shortform-video-model-settings';
import { ContiPreview } from '@/components/video/conti-preview';
import { MGrid, MPanel, MTag } from '@/components/mockup/primitives';

const PLATFORMS = [
  { key: 'youtube', label: 'YouTube', captionKey: 'caption_youtube' as const, uploadedKey: 'uploaded_youtube' as const },
  { key: 'tiktok', label: 'TikTok', captionKey: 'caption_tiktok' as const, uploadedKey: 'uploaded_tiktok' as const },
  { key: 'instagram', label: 'Instagram', captionKey: 'caption_instagram' as const, uploadedKey: 'uploaded_instagram' as const },
  { key: 'threads', label: 'Threads', captionKey: 'caption_threads' as const, uploadedKey: 'uploaded_threads' as const },
  { key: 'x', label: 'X', captionKey: 'caption_x' as const, uploadedKey: 'uploaded_x' as const },
];

function useVideoBlob(id: string | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !enabled) return;
    let revoked: string | null = null;
    void api.fetchVideoContentBlob(id).then((blob) => {
      revoked = URL.createObjectURL(blob);
      setUrl(revoked);
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
      setUrl(null);
    };
  }, [id, enabled]);
  return url;
}

function statusTone(status: string): 'ok' | 'warn' | 'err' | 'idle' {
  if (status === 'completed') return 'ok';
  if (status === 'conti_ready') return 'idle';
  if (status === 'failed' || status === 'on_hold') return 'err';
  return 'warn';
}

function CompletedDetail({
  item,
  accountName,
  onRefresh,
}: {
  item: HumaVideoContentHistory;
  accountName?: string;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState('youtube');
  const videoUrl = useVideoBlob(item.id, item.status === 'completed');
  const platform = PLATFORMS.find((p) => p.key === tab)!;
  const captionText = String(item[platform.captionKey] ?? '');
  const firstComment =
    tab === 'threads' ? item.first_comment_threads : tab === 'x' ? item.first_comment_x : null;

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    window.alert('클립보드에 복사되었습니다');
  };

  return (
    <div className="space-y-3">
      <div className="text-[13px] font-semibold text-huma-t">{accountName ?? item.account_id.slice(0, 8)}</div>
      {videoUrl ? (
        <video src={videoUrl} controls className="max-h-[360px] w-full rounded bg-black" playsInline />
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
        <button type="button" className="btn-ghost btn-sm" onClick={() => void copyText(captionText)}>
          캡션 복사
        </button>
        {firstComment ? (
          <button type="button" className="btn-ghost btn-sm" onClick={() => void copyText(firstComment)}>
            첫 댓글 복사
          </button>
        ) : null}
        <button type="button" className="btn-primary btn-sm" onClick={() => void api.downloadVideoContent(item.id)}>
          다운로드
        </button>
      </div>
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
  onRender,
  onRefresh,
}: {
  item: HumaVideoContentHistory;
  detail: HumaVideoContentHistory | null;
  accountName?: string;
  loadingDetail: boolean;
  rendering: boolean;
  onRender: () => void;
  onRefresh: () => void;
}) {
  const full = detail ?? item;
  const conti = parseContiPreview(full.conti_json);

  if (loadingDetail && !detail?.conti_json) {
    return <p className="text-[12px] text-huma-t3">콘티 불러오는 중…</p>;
  }

  if (item.status === 'completed') {
    return <CompletedDetail item={full} accountName={accountName} onRefresh={onRefresh} />;
  }

  if (item.status === 'conti_generating' || item.status === 'rendering' || item.status === 'generating') {
    return (
      <div className="py-12 text-center">
        <div className="mb-2 text-[28px] opacity-30">⏳</div>
        <div className="text-[14px] font-semibold text-huma-t2">
          {VIDEO_CONTENT_STATUS_LABEL[item.status] ?? item.status}
        </div>
        <p className="mt-2 font-mono text-[11px] text-huma-t3">
          {item.status === 'conti_generating'
            ? 'Sonnet이 콘티를 작성 중입니다. 완료되면 「검토 대기」 탭으로 이동합니다.'
            : 'EvoLink 영상 제작·자막·캡션 생성 중입니다.'}
        </p>
      </div>
    );
  }

  if (item.status === 'failed') {
    return (
      <div className="space-y-3">
        <p className="text-[12px] text-huma-err">{item.error_message ?? '생성 실패'}</p>
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
        {item.status === 'conti_ready' ? (
          <button type="button" className="btn-primary btn-sm" disabled={rendering} onClick={onRender}>
            {rendering ? '요청 중…' : '숏폼 생성'}
          </button>
        ) : null}
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
  const [filterAccount, setFilterAccount] = useState('');
  const [filterWorkspace, setFilterWorkspace] = useState('');
  const [activeTab, setActiveTab] = useState<VideoContentTab>('review');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HumaVideoContentHistory | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creatingConti, setCreatingConti] = useState(false);
  const [rendering, setRendering] = useState(false);

  const load = useCallback(async () => {
    const [accs, list] = await Promise.all([
      api.accounts(),
      api.videoContentList({
        account_id: filterAccount || undefined,
        workspace: filterWorkspace || undefined,
      }),
    ]);
    setAccounts(accs.filter((a) => a.account_type === 'posting'));
    setItems(list);
  }, [filterAccount, filterWorkspace]);

  useEffect(() => {
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 15_000);
    return () => clearInterval(t);
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
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    void api
      .videoContentGet(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const tabCounts = useMemo(() => countByVideoContentTab(items), [items]);
  const filteredItems = useMemo(() => filterByVideoContentTab(items, activeTab), [items, activeTab]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredItems.some((i) => i.id === selectedId)) {
      setSelectedId(filteredItems[0]!.id);
    }
  }, [filteredItems, selectedId]);

  const selectedItem = filteredItems.find((i) => i.id === selectedId) ?? items.find((i) => i.id === selectedId);

  const handleCreateConti = async () => {
    if (!filterAccount) {
      window.alert('콘티를 생성할 계정을 선택하세요.');
      return;
    }
    const name = accountMap.get(filterAccount) ?? filterAccount.slice(0, 8);
    if (!window.confirm(`${name} 계정으로 콘티 1건을 생성합니다.`)) return;
    setCreatingConti(true);
    try {
      await api.generateConti(filterAccount);
      window.alert('콘티 생성이 시작되었습니다. 완료되면 「검토 대기」 탭에서 확인하세요.');
      setActiveTab('progress');
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '콘티 생성 실패');
    } finally {
      setCreatingConti(false);
    }
  };

  const handleRender = async () => {
    if (!selectedId) return;
    if (!window.confirm('검토한 콘티로 숏폼 영상을 제작합니다. 수 분 소요될 수 있습니다.')) return;
    setRendering(true);
    try {
      await api.renderVideoContent(selectedId);
      window.alert('숏폼 영상 제작이 시작되었습니다.');
      setActiveTab('progress');
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '영상 제작 실패');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="space-y-4 p-1">
      <p className="text-[12px] leading-relaxed text-huma-t3">
        ① 계정 선택 → <strong className="text-huma-t2">콘티 생성</strong> (Sonnet) → ② 콘티 검토 →{' '}
        <strong className="text-huma-t2">숏폼 생성</strong> (EvoLink). 네이버 포스팅은{' '}
        <Link href="/queue" className="text-huma-acc hover:underline">
          포스팅 큐 관리
        </Link>
        를 사용하세요.
      </p>

      <MGrid cols={2}>
        <ShortformVideoModelSettings />
        <MPanel title="📊 작업 현황">
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(VIDEO_CONTENT_TAB_LABEL) as VideoContentTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`rounded border px-2 py-2 text-center transition-colors ${
                  activeTab === tab ? 'border-huma-acc bg-huma-glow' : 'border-huma-bdr bg-huma-bg2'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                <div className="text-[16px] font-bold text-huma-t">{tabCounts[tab]}</div>
                <div className="text-[9px] text-huma-t3">{VIDEO_CONTENT_TAB_LABEL[tab]}</div>
              </button>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-huma-t3">
            페르소나는 계정 관리 → 「영상 페르소나」에서 설정합니다.
          </p>
        </MPanel>
      </MGrid>

      <div className="flex min-h-[520px] gap-3">
        {/* 좌: 작업 목록 */}
        <div className="flex w-[280px] shrink-0 flex-col rounded-lg border border-huma-bdr bg-huma-bg2">
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
              value={filterAccount}
              onChange={(e) => setFilterAccount(e.target.value)}
            >
              <option value="">계정 선택 (콘티 생성용)</option>
              {accounts
                .filter((a) => !filterWorkspace || a.workspace === filterWorkspace)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary btn-sm flex-1"
                disabled={!filterAccount || creatingConti}
                onClick={() => void handleCreateConti()}
              >
                {creatingConti ? '요청 중…' : '콘티 생성'}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}>
                ↻
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
                          {accountMap.get(item.account_id) ?? item.account_id.slice(0, 6)}
                        </span>
                        <MTag tone={statusTone(item.status)} className="shrink-0 text-[9px]">
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
        <MPanel title="📄 작업 상세" className="min-w-0 flex-1">
          {selectedItem ? (
            <DetailPanel
              item={selectedItem}
              detail={detail}
              accountName={accountMap.get(selectedItem.account_id)}
              loadingDetail={loadingDetail}
              rendering={rendering}
              onRender={() => void handleRender()}
              onRefresh={() => void load()}
            />
          ) : (
            <div className="py-16 text-center text-[12px] text-huma-t3">
              왼쪽에서 작업을 선택하거나
              <br />
              계정을 고른 뒤 「콘티 생성」을 누르세요.
            </div>
          )}
        </MPanel>
      </div>
    </div>
  );
}
