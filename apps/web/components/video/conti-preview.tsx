'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContiPreviewData } from '@/lib/video-content-status';
import { VIDEO_PRIMARY_BTN } from '@/components/video/video-content-ui';

export type ShotDialogueDraft = { shotNumber: number; dialogue: string; action: string };

function syncTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const CONTI_ACTION_TEXTAREA =
  'w-full min-h-[2rem] rounded-md border border-huma-bdr bg-huma-bg3 px-2 py-1.5 font-[inherit] text-[11.5px] leading-relaxed text-huma-t outline-none focus:border-huma-acc';

const CONTI_DIALOGUE_TEXTAREA =
  'w-full min-h-[2rem] rounded-md border border-huma-bdr bg-huma-bg3 px-2 py-1.5 font-[inherit] text-[11.5px] leading-relaxed text-huma-warn outline-none focus:border-huma-acc';

function AutoHeightTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    syncTextareaHeight(el);
    const observer = new ResizeObserver(() => syncTextareaHeight(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
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

export function ContiPreview({
  conti,
  editable = false,
  onSaveDialogues,
}: {
  conti: ContiPreviewData;
  editable?: boolean;
  onSaveDialogues?: (dialogues: ShotDialogueDraft[]) => Promise<void>;
}) {
  const shots = conti.shots ?? [];
  const shotsFingerprint = useMemo(
    () =>
      JSON.stringify(
        shots.map((s, i) => ({
          shotNumber: s.shotNumber ?? i + 1,
          dialogue: s.dialogue ?? '',
          action: s.action ?? '',
        })),
      ),
    [shots],
  );
  const initialDrafts = useMemo(
    () =>
      shots.map((s, i) => ({
        shotNumber: s.shotNumber ?? i + 1,
        dialogue: s.dialogue ?? '',
        action: s.action ?? '',
      })),
    [shotsFingerprint],
  );
  const [drafts, setDrafts] = useState(initialDrafts);
  const [saving, setSaving] = useState(false);
  const syncedFingerprintRef = useRef('');

  useEffect(() => {
    if (syncedFingerprintRef.current === shotsFingerprint) return;
    syncedFingerprintRef.current = shotsFingerprint;
    setDrafts(initialDrafts);
  }, [shotsFingerprint, initialDrafts]);

  const dirty = drafts.some(
    (d, i) =>
      d.dialogue !== (shots[i]?.dialogue ?? '') || d.action !== (shots[i]?.action ?? ''),
  );

  const handleSave = async () => {
    if (!onSaveDialogues || !dirty) return;
    setSaving(true);
    try {
      await onSaveDialogues(drafts);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 text-[11px]">
      {conti.scenarioSummary ? (
        <div>
          <div className="mb-1 font-semibold text-huma-t2">시나리오 요약</div>
          <p className="rounded-md border border-huma-bdr bg-huma-bg2 px-2.5 py-2 text-[11.5px] leading-relaxed text-huma-t whitespace-pre-wrap">
            {conti.scenarioSummary}
          </p>
        </div>
      ) : null}

      {conti.location || conti.lighting || conti.timeOfDay || conti.cutType || conti.duration ? (
        <div className="rounded-md border border-huma-bdr bg-huma-bg2 px-2.5 py-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px] leading-relaxed text-huma-t">
            {conti.location ? (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-huma-acc">•</span>
                <span>장소: {conti.location}</span>
              </div>
            ) : null}
            {conti.lighting ? (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-huma-acc">•</span>
                <span>조명: {conti.lighting}</span>
              </div>
            ) : null}
            {conti.timeOfDay ? (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-huma-acc">•</span>
                <span>시간: {conti.timeOfDay}</span>
              </div>
            ) : null}
            {conti.cutType ? (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-huma-acc">•</span>
                <span>컷: {conti.cutType}</span>
              </div>
            ) : null}
            {conti.duration ? (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-huma-acc">•</span>
                <span>길이: {Math.round(conti.duration)}s</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {conti.characters?.length ? (
        <div>
          <div className="mb-1 font-semibold text-huma-t2">등장인물</div>
          <ul className="space-y-1">
            {conti.characters.map((c, i) => (
              <li key={i} className="rounded border border-huma-bdr bg-huma-bg2 px-2 py-1">
                <span className="font-semibold text-huma-t">{c.label}</span>
                <span className="ml-2 text-huma-t3">
                  {[c.age, c.gender, c.hair, c.outfit].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {shots.length ? (
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-huma-t2">샷 구성</div>
            {editable ? (
              <button
                type="button"
                className={VIDEO_PRIMARY_BTN}
                disabled={!dirty || saving || !onSaveDialogues}
                onClick={() => void handleSave()}
              >
                {saving ? '저장 중…' : '액션/멘트 저장'}
              </button>
            ) : null}
          </div>
          <div className="max-h-[320px] overflow-y-auto rounded border border-huma-bdr">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[14%]" />
                <col className="w-[17%]" />
                <col />
              </colgroup>
              <thead className="sticky top-0 bg-huma-bg3 text-[10px] text-huma-t3">
                <tr>
                  <th className="p-1 text-left">#</th>
                  <th className="whitespace-nowrap p-1 text-left">시간</th>
                  <th className="whitespace-nowrap p-1 text-left">카메라</th>
                  <th className="p-1 text-left">액션 / 멘트</th>
                </tr>
              </thead>
              <tbody className="text-[11.5px] leading-relaxed text-huma-t">
                {shots.map((s, i) => (
                  <tr key={i} className="border-t border-huma-bdr2 align-top">
                    <td className="p-1">{s.shotNumber ?? i + 1}</td>
                    <td className="p-1 whitespace-nowrap">
                      {s.startSec != null && s.endSec != null ? `${s.startSec}–${s.endSec}s` : '—'}
                    </td>
                    <td className="p-1">{s.camera ?? '—'}</td>
                    <td className="p-1">
                      {editable ? (
                        <>
                          <AutoHeightTextarea
                            className={CONTI_ACTION_TEXTAREA}
                            value={drafts[i]?.action ?? ''}
                            placeholder="액션 없음"
                            onChange={(value) => {
                              setDrafts((prev) =>
                                prev.map((row, idx) => (idx === i ? { ...row, action: value } : row)),
                              );
                            }}
                          />
                          <AutoHeightTextarea
                            className={`${CONTI_DIALOGUE_TEXTAREA} mt-1`}
                            value={drafts[i]?.dialogue ?? ''}
                            placeholder="멘트 없음"
                            onChange={(value) => {
                              setDrafts((prev) =>
                                prev.map((row, idx) => (idx === i ? { ...row, dialogue: value } : row)),
                              );
                            }}
                          />
                        </>
                      ) : (
                        <>
                          {drafts[i]?.action ? <div>{drafts[i]!.action}</div> : null}
                          {drafts[i]?.dialogue ? (
                            <div className={`text-huma-warn ${drafts[i]?.action ? 'mt-1' : ''}`}>
                              「{drafts[i]!.dialogue}」
                            </div>
                          ) : !drafts[i]?.action ? (
                            <span className="text-huma-t4">—</span>
                          ) : null}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {conti.evolinkPrompt ? (
        <details className="rounded border border-huma-bdr bg-huma-bg2 p-2">
          <summary className="cursor-pointer font-mono text-[10px] text-huma-t3">
            EvoLink 프롬프트 ({conti.evolinkPrompt.length}자)
          </summary>
          <pre className="mt-2 max-h-[160px] overflow-y-auto whitespace-pre-wrap text-[10px] text-huma-t3">
            {conti.evolinkPrompt}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
