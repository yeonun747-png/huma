'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaAccount } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm } from '@/lib/app-dialog';
import {
  STORAGE_FILTER_LABEL,
  formatStorageBytes,
  type VideoContentStorageFilter,
  type VideoContentStorageItem,
  type VideoContentStorageSettings,
  type VideoContentStorageStats,
} from '@/lib/video-content-storage';
import { videoContentDisplayName } from '@/lib/video-content-targets';
import { MPanel } from '@/components/mockup/primitives';

const FILTERS: VideoContentStorageFilter[] = [
  'uploaded_with_source',
  'older_than_30',
  'failed_or_hold',
  'all_with_files',
];

export function VideoContentStorageModal({
  open,
  filterWorkspace,
  accounts,
  onClose,
  onDone,
  onOpenItem,
}: {
  open: boolean;
  filterWorkspace: string;
  accounts: HumaAccount[];
  onClose: () => void;
  onDone: () => void;
  onOpenItem: (id: string) => void;
}) {
  const [filter, setFilter] = useState<VideoContentStorageFilter>('uploaded_with_source');
  const [target, setTarget] = useState<'source' | 'subtitled'>('source');
  const [items, setItems] = useState<VideoContentStorageItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.videoContentStorageItems({
        workspace: filterWorkspace || undefined,
        filter,
      });
      setItems(list);
      setSelected(new Set(list.map((i) => i.id)));
    } catch {
      setItems([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [filter, filterWorkspace]);

  useEffect(() => {
    if (!open) return;
    void loadItems();
  }, [open, loadItems]);

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected],
  );

  const freedEstimate = useMemo(() => {
    return selectedItems.reduce(
      (sum, i) => sum + (target === 'source' ? i.sourceBytes : i.subtitledBytes),
      0,
    );
  }, [selectedItems, target]);

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(items.map((i) => i.id)) : new Set());
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = selectedItems
      .filter((i) => (target === 'source' ? i.hasSource : i.hasSubtitled))
      .map((i) => i.id);
    if (!ids.length) {
      await appAlert('삭제할 파일이 없습니다.');
      return;
    }
    const label = target === 'source' ? '원본' : '자막본';
    if (
      !(await appConfirm(
        `선택 ${ids.length}건의 ${label} mp4를 삭제합니다.\n약 ${formatStorageBytes(freedEstimate)} 확보\n\n콘티·캡션·작업 기록은 유지됩니다.`,
        { destructive: true },
      ))
    ) {
      return;
    }
    setDeleting(true);
    try {
      const result = await api.videoContentStorageBulkDelete(ids, target);
      await appAlert(`${result.deleted}건 삭제 · ${formatStorageBytes(result.freedBytes)} 확보`);
      onDone();
      onClose();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '일괄 삭제 실패');
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-huma-bdr bg-huma-bg2 shadow-xl">
        <div className="flex items-center justify-between border-b border-huma-bdr px-4 py-3">
          <h3 className="text-[14px] font-semibold text-huma-t">SSD 일괄 정리</h3>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-huma-bdr px-4 py-3">
          <select
            className="m-model-select text-[11px]"
            value={filter}
            onChange={(e) => setFilter(e.target.value as VideoContentStorageFilter)}
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {STORAGE_FILTER_LABEL[f]}
              </option>
            ))}
          </select>
          <select
            className="m-model-select text-[11px]"
            value={target}
            onChange={(e) => setTarget(e.target.value as 'source' | 'subtitled')}
          >
            <option value="source">삭제 대상: 원본</option>
            <option value="subtitled">삭제 대상: 자막본</option>
          </select>
          <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => void loadItems()}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {items.length ? (
            <table className="w-full text-[10.5px]">
              <thead>
                <tr className="text-left text-huma-t3">
                  <th className="py-1 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.size === items.length && items.length > 0}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th className="py-1">계정</th>
                  <th className="py-1">용량</th>
                  <th className="py-1">파일</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-huma-bdr/50">
                    <td className="py-1.5 pr-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                      />
                    </td>
                    <td className="py-1.5">
                      <div className="font-semibold text-huma-t">
                        {videoContentDisplayName(item.account_id, accounts)}
                      </div>
                      <div className="truncate text-huma-t4">{item.scenario_summary || '—'}</div>
                    </td>
                    <td className="py-1.5 font-mono text-huma-t2">{formatStorageBytes(item.totalBytes)}</td>
                    <td className="py-1.5 text-huma-t3">
                      {item.hasSubtitled ? '자막 ' : ''}
                      {item.hasSource ? '원본' : ''}
                    </td>
                    <td className="py-1.5">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => onOpenItem(item.id)}>
                        보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-[11px] text-huma-t3">
              {loading ? '목록 불러오는 중…' : '조건에 맞는 파일이 없습니다'}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-huma-bdr px-4 py-3">
          <span className="font-mono text-[10.5px] text-huma-t3">
            선택 {selectedItems.length}건 · 예상 확보 {formatStorageBytes(freedEstimate)}
          </span>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={deleting || !selectedItems.length}
            onClick={() => void handleBulkDelete()}
          >
            {deleting ? '삭제 중…' : '선택 항목 삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}
