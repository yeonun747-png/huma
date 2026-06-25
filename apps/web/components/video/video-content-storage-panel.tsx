'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaAccount } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm } from '@/lib/app-dialog';
import {
  STORAGE_FILTER_LABEL,
  groupStorageFiles,
  formatStorageBytes,
  type VideoContentStorageFile,
  type VideoContentStoragePair,
  type VideoContentStorageFilter,
  type VideoContentStorageSettings,
  type VideoContentStorageStats,
} from '@/lib/video-content-storage';
import { videoContentDisplayName } from '@/lib/video-content-targets';
import { VideoContentStorageModal } from '@/components/video/video-content-storage-modal';
import {
  VideoContentPlaybackModal,
  VideoContentStorageFileGrid,
} from '@/components/video/video-content-storage-files';
import { MPanel } from '@/components/mockup/primitives';

const LIST_FILTERS: VideoContentStorageFilter[] = [
  'all_with_files',
  'uploaded_with_source',
  'older_than_30',
  'failed_or_hold',
];

function usageBarClass(level: VideoContentStorageStats['warnLevel']): string {
  if (level === 'critical') return 'bg-huma-err';
  if (level === 'warn') return 'bg-huma-warn';
  return 'bg-huma-ok';
}

type StorageNumKey =
  | 'ssdCapGb'
  | 'warnPercent'
  | 'autoDeleteSourceDaysAfterUpload'
  | 'autoDeleteSubtitledDays';

function parseStorageSettingNum(key: StorageNumKey, raw: string, fallback: number): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  switch (key) {
    case 'ssdCapGb':
      return Math.max(1, n);
    case 'warnPercent':
      return Math.min(100, Math.max(50, n));
    case 'autoDeleteSourceDaysAfterUpload':
    case 'autoDeleteSubtitledDays':
      return Math.max(0, n);
  }
}

function StoragePolicyNumberInput({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (raw: string) => void;
  onCommit: (raw?: string) => void;
}) {
  const parsed = Number.parseInt(value.trim(), 10);
  const base = Number.isFinite(parsed) ? parsed : (min ?? 0);
  const atMin = min != null && base <= min;
  const atMax = max != null && base >= max;

  const stepBy = (delta: number) => {
    if (disabled) return;
    let next = base + delta;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    const nextStr = String(next);
    onChange(nextStr);
    onCommit(nextStr);
  };

  return (
    <label className="block text-huma-t3">
      {label}
      <div className="m-num-field">
        <input
          type="number"
          min={min}
          max={max}
          className="m-num-input"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          onBlur={() => onCommit(value)}
        />
        <div className="m-num-stepper" aria-hidden={disabled}>
          <button
            type="button"
            className="m-num-step"
            tabIndex={-1}
            disabled={disabled || atMax}
            aria-label={`${label} 증가`}
            onClick={() => stepBy(1)}
          >
            ▲
          </button>
          <button
            type="button"
            className="m-num-step"
            tabIndex={-1}
            disabled={disabled || atMin}
            aria-label={`${label} 감소`}
            onClick={() => stepBy(-1)}
          >
            ▼
          </button>
        </div>
      </div>
      {hint ? <span className="text-[10px] text-huma-t4">{hint}</span> : null}
    </label>
  );
}

export function VideoContentStoragePanel({
  filterWorkspace,
  accounts,
  refreshToken,
  onOpenItem,
  onRefresh,
}: {
  filterWorkspace: string;
  accounts: HumaAccount[];
  refreshToken: number;
  onOpenItem: (id: string) => void;
  onRefresh: () => void;
}) {
  const [stats, setStats] = useState<VideoContentStorageStats | null>(null);
  const [settings, setSettings] = useState<VideoContentStorageSettings | null>(null);
  const [listFilter, setListFilter] = useState<VideoContentStorageFilter>('all_with_files');
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [pairs, setPairs] = useState<VideoContentStoragePair[]>([]);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [playFile, setPlayFile] = useState<VideoContentStorageFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [numDrafts, setNumDrafts] = useState<Record<StorageNumKey, string>>({
    ssdCapGb: '50',
    warnPercent: '80',
    autoDeleteSourceDaysAfterUpload: '7',
    autoDeleteSubtitledDays: '90',
  });

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.videoContentStorageStats(filterWorkspace || undefined);
      setStats(data.stats);
      setSettings(data.settings);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [filterWorkspace]);

  const loadFiles = useCallback(async () => {
    setListLoading(true);
    try {
      const items = await api.videoContentStorageItems({
        workspace: filterWorkspace || undefined,
        filter: listFilter,
      });
      setPairs(groupStorageFiles(items));
    } catch {
      setPairs([]);
    } finally {
      setListLoading(false);
    }
  }, [filterWorkspace, listFilter]);

  useEffect(() => {
    void loadStats();
  }, [loadStats, refreshToken]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, refreshToken]);

  useEffect(() => {
    if (!settings) return;
    setNumDrafts({
      ssdCapGb: String(settings.ssdCapGb),
      warnPercent: String(settings.warnPercent),
      autoDeleteSourceDaysAfterUpload: String(settings.autoDeleteSourceDaysAfterUpload),
      autoDeleteSubtitledDays: String(settings.autoDeleteSubtitledDays),
    });
  }, [settings]);

  const playAccountLabel = useMemo(() => {
    if (!playFile) return '';
    return videoContentDisplayName(playFile.account_id, accounts);
  }, [playFile, accounts]);

  const saveSettings = async (patch: Partial<VideoContentStorageSettings>) => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await api.updateVideoContentStorageSettings({ ...settings, ...patch });
      setSettings(res.settings);
      const data = await api.videoContentStorageStats(filterWorkspace || undefined);
      setStats(data.stats);
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '설정 저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const commitNumDraft = async (key: StorageNumKey, raw?: string) => {
    if (!settings) return;
    const text = raw ?? numDrafts[key];
    const parsed = parseStorageSettingNum(key, text, settings[key]);
    setNumDrafts((d) => ({ ...d, [key]: String(parsed) }));
    if (parsed === settings[key]) return;
    await saveSettings({ [key]: parsed });
  };

  const runCleanupNow = async () => {
    if (!(await appConfirm('자동 정책 기준으로 지금 즉시 정리합니다. 계속할까요?'))) return;
    setRunningCleanup(true);
    try {
      const result = await api.runVideoContentStorageCleanup();
      await appAlert(
        `정리 완료 — 원본 ${result.deletedSources}건, 자막본 ${result.deletedSubtitled}건 · ${formatStorageBytes(result.freedBytes)} 확보`,
      );
      onRefresh();
      await Promise.all([loadStats(), loadFiles()]);
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '정리 실패');
    } finally {
      setRunningCleanup(false);
    }
  };

  const s = stats;
  const st = settings;

  return (
    <>
      <MPanel title="💾 보관 파일 (SSD)">
        {loading && !s ? (
          <p className="text-[11px] text-huma-t3">용량 집계 중…</p>
        ) : s && st ? (
          <div className="space-y-4">
            {s.warnLevel !== 'ok' ? (
              <div
                className={`rounded border px-3 py-2 text-[11px] ${
                  s.warnLevel === 'critical'
                    ? 'border-huma-err/40 bg-huma-err/10 text-huma-err'
                    : 'border-huma-warn/40 bg-huma-warn/10 text-huma-warn'
                }`}
              >
                SSD 사용 {s.usedPercent}% — {s.warnLevel === 'critical' ? '즉시' : ''} 정리를 권장합니다
                {s.reclaimableSourceCount > 0
                  ? ` (업로드 완료 원본 ${s.reclaimableSourceCount}건 · ${formatStorageBytes(s.reclaimableSourceBytes)})`
                  : ''}
              </div>
            ) : null}

            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-huma-t3">
                  <span>
                    영상 {formatStorageBytes(s.totalBytes)} / {st.ssdCapGb} GB ({s.usedPercent}%)
                  </span>
                  <span className="text-huma-t4">|</span>
                  <span className="text-huma-t4">
                    자막본 {formatStorageBytes(s.subtitledBytes)} · 원본 {formatStorageBytes(s.sourceBytes)}
                  </span>
                  <span className="text-huma-t4">|</span>
                  <span>
                    완료 {s.completedCount} · 양쪽 {s.withBothCount} · 자막만 {s.subtitledOnlyCount}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
                    일괄 정리
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setShowPolicy((v) => !v)}>
                    {showPolicy ? '자동 정책 접기' : '자동 정책'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={runningCleanup || !st.autoCleanupEnabled}
                    onClick={() => void runCleanupNow()}
                  >
                    {runningCleanup ? '정리 중…' : '지금 정리 실행'}
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                    <span className="font-mono text-[10.5px] text-huma-t3">
                      파일 목록{!listLoading ? ` (${pairs.length}건)` : ''}
                    </span>
                    <select
                      className="m-model-select max-w-[128px] shrink-0 py-0.5 pl-1.5 pr-6 text-[10px] leading-tight"
                      value={listFilter}
                      onChange={(e) => setListFilter(e.target.value as VideoContentStorageFilter)}
                    >
                      {LIST_FILTERS.map((f) => (
                        <option key={f} value={f}>
                          {STORAGE_FILTER_LABEL[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-huma-bg3">
                <div
                  className={`h-full transition-all ${usageBarClass(s.warnLevel)}`}
                  style={{ width: `${Math.max(s.usedPercent, s.totalBytes > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>

            {showPolicy ? (
              <div className="space-y-2 rounded border border-huma-bdr bg-huma-bg3 p-3 text-[11px]">
                <label className="flex items-center gap-2 text-huma-t2">
                  <input
                    type="checkbox"
                    checked={st.autoCleanupEnabled}
                    disabled={saving}
                    onChange={(e) => void saveSettings({ autoCleanupEnabled: e.target.checked })}
                  />
                  자동 정리 활성 (매일 04:30 KST)
                </label>
                <p className="text-[10px] text-huma-t4">숫자 입력 후 Enter 또는 포커스 아웃 시 저장됩니다.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <StoragePolicyNumberInput
                    label="SSD 상한 (GB)"
                    value={numDrafts.ssdCapGb}
                    min={1}
                    disabled={saving}
                    onChange={(raw) => setNumDrafts((d) => ({ ...d, ssdCapGb: raw }))}
                    onCommit={(raw) => void commitNumDraft('ssdCapGb', raw)}
                  />
                  <StoragePolicyNumberInput
                    label="경고 (%)"
                    value={numDrafts.warnPercent}
                    min={50}
                    max={100}
                    disabled={saving}
                    onChange={(raw) => setNumDrafts((d) => ({ ...d, warnPercent: raw }))}
                    onCommit={(raw) => void commitNumDraft('warnPercent', raw)}
                  />
                  <StoragePolicyNumberInput
                    label="원본 삭제 (업로드 완료 후 일)"
                    hint="0 = 비활성"
                    value={numDrafts.autoDeleteSourceDaysAfterUpload}
                    min={0}
                    disabled={saving}
                    onChange={(raw) => setNumDrafts((d) => ({ ...d, autoDeleteSourceDaysAfterUpload: raw }))}
                    onCommit={(raw) => void commitNumDraft('autoDeleteSourceDaysAfterUpload', raw)}
                  />
                  <StoragePolicyNumberInput
                    label="자막본 삭제 (완료 후 일)"
                    hint="0 = 비활성 · 콘티·캡션 유지"
                    value={numDrafts.autoDeleteSubtitledDays}
                    min={0}
                    disabled={saving}
                    onChange={(raw) => setNumDrafts((d) => ({ ...d, autoDeleteSubtitledDays: raw }))}
                    onCommit={(raw) => void commitNumDraft('autoDeleteSubtitledDays', raw)}
                  />
                </div>
              </div>
            ) : null}

            {listLoading ? (
              <p className="py-6 text-center text-[11px] text-huma-t3">파일 목록 불러오는 중…</p>
            ) : (
              <VideoContentStorageFileGrid
                pairs={pairs}
                accountLabel={(id) => videoContentDisplayName(id, accounts)}
                onPlay={setPlayFile}
                onOpenJob={onOpenItem}
              />
            )}
          </div>
        ) : (
          <p className="text-[11px] text-huma-t3">저장소 정보를 불러오지 못했습니다.</p>
        )}
      </MPanel>

      <VideoContentPlaybackModal
        file={playFile}
        accountLabel={playAccountLabel}
        onClose={() => setPlayFile(null)}
      />

      <VideoContentStorageModal
        open={showModal}
        filterWorkspace={filterWorkspace}
        accounts={accounts}
        onClose={() => setShowModal(false)}
        onDone={() => {
          onRefresh();
          void Promise.all([loadStats(), loadFiles()]);
        }}
        onOpenItem={(id) => {
          setShowModal(false);
          onOpenItem(id);
        }}
      />
    </>
  );
}
