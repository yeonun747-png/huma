'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaAccount, HumaVideoContentHistory } from '@huma/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getAccessibleBusinessUnits } from '@/lib/admin-scope';
import { WORKSPACES } from '@/lib/constants';

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

function ContentCard({
  item,
  accountName,
  selected,
  onSelect,
}: {
  item: HumaVideoContentHistory;
  accountName?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const [tab, setTab] = useState('youtube');
  const videoUrl = useVideoBlob(item.id, selected && item.status === 'completed');
  const platform = PLATFORMS.find((p) => p.key === tab)!;

  const captionText = String(item[platform.captionKey] ?? '');
  const firstComment =
    tab === 'threads' ? item.first_comment_threads : tab === 'x' ? item.first_comment_x : null;

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    window.alert('클립보드에 복사되었습니다');
  };

  const toggleUploaded = async (platformKey: string, checked: boolean) => {
    await api.updateVideoContentUpload(item.id, { [`uploaded_${platformKey}`]: checked });
  };

  return (
    <div
      className={`m-panel cursor-pointer transition-colors ${selected ? 'ring-1 ring-huma-acc' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-huma-t">{accountName ?? item.account_id.slice(0, 8)}</div>
          <div className="text-[10px] text-huma-t3">
            {new Date(item.created_at).toLocaleString('ko-KR')} · {item.status}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {PLATFORMS.map((p) => (
            <label key={p.key} className="flex items-center gap-1 text-[10px] text-huma-t2" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={Boolean(item[p.uploadedKey])}
                onChange={(e) => void toggleUploaded(p.key, e.target.checked).then(() => onSelect())}
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      {selected && item.status === 'completed' && videoUrl ? (
        <video src={videoUrl} controls className="mb-3 max-h-[360px] w-full rounded bg-black" playsInline />
      ) : null}

      {selected ? (
        <>
          <div className="mb-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
            {PLATFORMS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`m-af ${tab === p.key ? 'e' : ''}`}
                onClick={() => setTab(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mb-2 rounded border border-huma-bdr bg-huma-bg2 p-2 text-[11px] whitespace-pre-wrap" onClick={(e) => e.stopPropagation()}>
            {captionText || '(캡션 없음)'}
          </div>
          {firstComment ? (
            <div className="mb-2 text-[10px] text-huma-t3" onClick={(e) => e.stopPropagation()}>
              <span className="font-semibold">첫 댓글:</span> {firstComment}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn-ghost btn-sm" onClick={() => void copyText(captionText)}>
              캡션 복사
            </button>
            {firstComment ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => void copyText(firstComment)}>
                첫 댓글 복사
              </button>
            ) : null}
            {item.status === 'completed' ? (
              <button type="button" className="btn-primary btn-sm" onClick={() => void api.downloadVideoContent(item.id)}>
                다운로드
              </button>
            ) : null}
          </div>
          <div className="mt-2 text-[10px] text-huma-t3">
            {item.scenario_summary}
            <br />
            {item.relationship_axis} · {item.emotion_curve} · {item.hook_type} · {item.cut_type} · {item.duration}s
            {item.similarity_score != null ? ` · 유사도 ${Number(item.similarity_score).toFixed(3)}` : ''}
          </div>
        </>
      ) : null}

      {item.error_message ? <p className="mt-1 text-[10px] text-huma-err">{item.error_message}</p> : null}
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
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
    if (id) setSelectedId(id);
  }, []);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  return (
    <div className="space-y-4 p-1">
      <p className="text-[12px] text-huma-t3">
        생성된 영상 미리보기·다운로드 및 플랫폼별 캡션 복사. 업로드는 수기로 진행하고 완료 체크만 표시합니다.
      </p>

      <div className="flex flex-wrap gap-2">
        <select
          className="m-model-select w-auto min-w-[140px]"
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
          className="m-model-select w-auto min-w-[160px]"
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
        >
          <option value="">전체 계정</option>
          {accounts
            .filter((a) => !filterWorkspace || a.workspace === filterWorkspace)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <button type="button" className="btn-ghost btn-sm" onClick={() => void load()}>
          새로고침
        </button>
      </div>

      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              accountName={accountMap.get(item.account_id)}
              selected={selectedId === item.id}
              onSelect={() => {
                setSelectedId(item.id);
                void load();
              }}
            />
          ))}
        </div>
      ) : (
        <div className="m-panel text-center text-[12px] text-huma-t3">생성된 영상 콘텐츠가 없습니다</div>
      )}
    </div>
  );
}
