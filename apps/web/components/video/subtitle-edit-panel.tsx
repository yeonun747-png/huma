'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContiPreviewData } from '@/lib/video-content-status';
import { api } from '@/lib/api';
import { appConfirm } from '@/lib/app-dialog';
import { ContiPreview, type ShotDialogueDraft } from '@/components/video/conti-preview';
import type { SubtitlePreviewEvent } from '@/components/video/subtitle-preview-overlay';
import { VIDEO_PRIMARY_BTN } from '@/components/video/video-content-ui';

export type ShotSubtitleDraft = ShotDialogueDraft & {
  startSec: number;
  endSec: number;
};

function formatSecLabel(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toFixed(1).padStart(m > 0 ? 4 : 3, '0')}`;
}

function syncTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const DIALOGUE_TEXTAREA =
  'w-full min-h-[2rem] rounded-md border border-huma-bdr bg-huma-bg3 px-2 py-1.5 font-[inherit] text-[11.5px] leading-relaxed text-huma-warn outline-none focus:border-huma-acc';

const TIME_INPUT =
  'w-[4.2rem] rounded border border-huma-bdr bg-huma-bg3 px-1 py-0.5 font-mono text-[10px] text-huma-t outline-none focus:border-huma-acc';

function AutoHeightTextarea({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    syncTextareaHeight(el);
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      disabled={disabled}
      className={DIALOGUE_TEXTAREA}
      value={value}
      placeholder={placeholder}
      style={{ overflow: 'hidden', resize: 'none' }}
      onChange={(e) => {
        onChange(e.target.value);
        syncTextareaHeight(e.target);
      }}
    />
  );
}

function shotsToDrafts(conti: ContiPreviewData): ShotSubtitleDraft[] {
  return (conti.shots ?? []).map((s, i) => ({
    shotNumber: s.shotNumber ?? i + 1,
    dialogue: s.dialogue ?? '',
    action: s.action ?? '',
    startSec: Number(s.startSec) || 0,
    endSec: Number(s.endSec) || 0,
  }));
}

function contiShotsFingerprint(conti: ContiPreviewData): string {
  return JSON.stringify(
    (conti.shots ?? []).map((s, i) => ({
      shotNumber: s.shotNumber ?? i + 1,
      dialogue: s.dialogue ?? '',
      action: s.action ?? '',
      startSec: Number(s.startSec) || 0,
      endSec: Number(s.endSec) || 0,
    })),
  );
}

function draftsEqual(a: ShotSubtitleDraft[], b: ShotSubtitleDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (d, i) =>
      d.dialogue === b[i]!.dialogue &&
      d.action === b[i]!.action &&
      d.startSec === b[i]!.startSec &&
      d.endSec === b[i]!.endSec,
  );
}

export function SubtitleEditPanel({
  historyId,
  conti,
  hasSource,
  reburning,
  restoring,
  reburnCount,
  canRestore,
  previewEnabled,
  onPreviewEnabledChange,
  onPreviewEventsChange,
  onSeek,
  onSaveOnly,
  onSaveAndApply,
  onRestore,
  onApplyWithoutSave,
}: {
  historyId: string;
  conti: ContiPreviewData;
  hasSource: boolean;
  reburning: boolean;
  restoring: boolean;
  reburnCount: number;
  canRestore: boolean;
  previewEnabled: boolean;
  onPreviewEnabledChange: (v: boolean) => void;
  onPreviewEventsChange: (events: SubtitlePreviewEvent[]) => void;
  onSeek: (sec: number) => void;
  onSaveOnly: (drafts: ShotSubtitleDraft[]) => Promise<void>;
  onSaveAndApply: (drafts: ShotSubtitleDraft[]) => Promise<void>;
  onRestore: () => Promise<void>;
  onApplyWithoutSave: (opts?: { skipConfirm?: boolean }) => Promise<void>;
}) {
  const shotsFingerprint = contiShotsFingerprint(conti);
  const initialDrafts = useMemo(() => shotsToDrafts(conti), [shotsFingerprint]);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [saving, setSaving] = useState(false);
  const [showFullConti, setShowFullConti] = useState(false);
  const [activeShot, setActiveShot] = useState<number | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedFingerprintRef = useRef('');

  useEffect(() => {
    const fp = `${historyId}:${shotsFingerprint}`;
    if (syncedFingerprintRef.current === fp) return;
    syncedFingerprintRef.current = fp;
    setDrafts(initialDrafts);
  }, [historyId, shotsFingerprint, initialDrafts]);

  const dirty = !draftsEqual(drafts, initialDrafts);
  const busy = saving || reburning || restoring;

  const loadPreview = useCallback(async () => {
    if (!previewEnabled) {
      onPreviewEventsChange([]);
      return;
    }
    try {
      const res = await api.previewVideoSubtitles(historyId, drafts);
      onPreviewEventsChange(res.events);
    } catch {
      onPreviewEventsChange([]);
    }
  }, [previewEnabled, historyId, drafts, onPreviewEventsChange]);

  useEffect(() => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      void loadPreview();
    }, 280);
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [loadPreview]);

  const handleSaveOnly = async () => {
    setSaving(true);
    try {
      await onSaveOnly(drafts);
    } finally {
      setSaving(false);
    }
  };

  const handlePrimaryApply = async () => {
    if (!hasSource || busy) return;
    setSaving(true);
    try {
      if (dirty) {
        await onSaveAndApply(drafts);
      } else {
        await onApplyWithoutSave({ skipConfirm: true });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleApplyWithoutSave = async () => {
    if (!hasSource) return;
    if (
      !(await appConfirm(
        dirty
          ? '저장되지 않은 변경은 반영되지 않습니다.\n현재 저장된 멘트로 자막만 다시 입힐까요?'
          : '멘트 변경 없이 자막 스타일·타이밍만 다시 적용합니다.\n(수십 초 소요)',
      ))
    ) {
      return;
    }
    await onApplyWithoutSave();
  };

  const updateDraft = (index: number, patch: Partial<ShotSubtitleDraft>) => {
    setDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const saveFullConti = async (dialogues: ShotDialogueDraft[]) => {
    await onSaveOnly(
      dialogues.map((d, i) => ({
        ...d,
        startSec: drafts[i]?.startSec ?? 0,
        endSec: drafts[i]?.endSec ?? 0,
      })),
    );
  };

  return (
    <div id="subtitle-edit-panel" className="rounded-lg border border-huma-bdr bg-huma-bg2 scroll-mt-3">
      <div className="border-b border-huma-bdr px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-huma-t">💬 자막만 다시 입히기(무료)</div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-huma-t3">
              원본 영상은 그대로, 아래 멘트·구간 기준으로 자막만 다시 입힙니다.
              {reburnCount > 0 ? (
                <span className="ml-1 font-mono text-huma-t4">· 수정 {reburnCount}회</span>
              ) : null}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-huma-t2">
            <input
              type="checkbox"
              className="accent-huma-acc"
              checked={previewEnabled}
              disabled={busy}
              onChange={(e) => onPreviewEnabledChange(e.target.checked)}
            />
            영상 미리보기
          </label>
        </div>
      </div>

      {!hasSource ? (
        <p className="px-3 py-4 text-[11px] text-huma-warn">
          원본 영상이 없어 자막 수정·적용이 불가합니다. (신규 생성분부터 원본 보관)
        </p>
      ) : (
        <div className="max-h-[320px] overflow-y-auto p-2">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-wide text-huma-t4">
                <th className="w-8 p-1">샷</th>
                <th className="w-[9.5rem] p-1">구간 (초)</th>
                <th className="p-1">자막 멘트</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((row, i) => {
                const highlighted = activeShot === row.shotNumber;
                return (
                  <tr
                    key={row.shotNumber}
                    className={`border-t border-huma-bdr/60 align-top ${highlighted ? 'bg-huma-glow/40' : ''}`}
                    onMouseEnter={() => setActiveShot(row.shotNumber)}
                    onMouseLeave={() => setActiveShot(null)}
                  >
                    <td className="p-1 font-mono text-huma-t3">{row.shotNumber}</td>
                    <td className="p-1">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            disabled={busy}
                            className={TIME_INPUT}
                            value={Number.isFinite(row.startSec) ? row.startSec : 0}
                            onChange={(e) => updateDraft(i, { startSec: Number(e.target.value) })}
                          />
                          <span className="text-huma-t4">–</span>
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            disabled={busy}
                            className={TIME_INPUT}
                            value={Number.isFinite(row.endSec) ? row.endSec : 0}
                            onChange={(e) => updateDraft(i, { endSec: Number(e.target.value) })}
                          />
                        </div>
                        <button
                          type="button"
                          className="text-left font-mono text-[9px] text-huma-acc hover:underline"
                          disabled={busy}
                          onClick={() => onSeek(row.startSec)}
                        >
                          ▶ {formatSecLabel(row.startSec)}
                        </button>
                      </div>
                    </td>
                    <td className="p-1">
                      <AutoHeightTextarea
                        value={row.dialogue}
                        disabled={busy}
                        placeholder="멘트 없음"
                        onChange={(value) => updateDraft(i, { dialogue: value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-huma-bdr px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {canRestore ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => void onRestore()}
            >
              {restoring ? '복원 중…' : '↩ 이전 자막본'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy || !hasSource}
            onClick={() => void handleApplyWithoutSave()}
          >
            {reburning ? '적용 중…' : '저장본으로만 적용'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={!dirty || busy || !hasSource}
            onClick={() => {
              setDrafts(initialDrafts);
            }}
          >
            취소
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={!dirty || busy || !hasSource}
            onClick={() => void handleSaveOnly()}
          >
            {saving && !reburning ? '저장 중…' : '저장만'}
          </button>
          <button
            type="button"
            className={`${VIDEO_PRIMARY_BTN} ${reburning ? 'animate-pulse' : ''}`}
            disabled={busy || !hasSource}
            onClick={() => void handlePrimaryApply()}
          >
            {reburning ? '자막 적용 중…' : '자막만 다시 입히기(무료)'}
          </button>
        </div>
      </div>

      <div className="border-t border-huma-bdr px-3 py-2">
        <button
          type="button"
          className="text-[10px] text-huma-t3 hover:text-huma-acc"
          onClick={() => setShowFullConti((v) => !v)}
        >
          {showFullConti ? '▾ 콘티 전체 접기' : '▸ 콘티 전체 보기 (액션·카메라)'}
        </button>
        {showFullConti ? (
          <div className="mt-2 rounded border border-huma-bdr bg-huma-bg3 p-2">
            <ContiPreview conti={conti} editable onSaveDialogues={saveFullConti} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
