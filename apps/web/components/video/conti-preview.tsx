'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContiPreviewData } from '@/lib/video-content-status';

export type ShotDialogueDraft = { shotNumber: number; dialogue: string };

function syncTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = '0px';
  el.style.height = `${el.scrollHeight}px`;
}

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
    if (ref.current) syncTextareaHeight(ref.current);
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
  const initialDrafts = useMemo(
    () => shots.map((s, i) => ({ shotNumber: s.shotNumber ?? i + 1, dialogue: s.dialogue ?? '' })),
    [shots],
  );
  const [drafts, setDrafts] = useState(initialDrafts);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDrafts(initialDrafts);
  }, [initialDrafts]);

  const dirty = drafts.some((d, i) => d.dialogue !== (shots[i]?.dialogue ?? ''));

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
          <p className="whitespace-pre-wrap text-huma-t3">{conti.scenarioSummary}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px] text-huma-t3">
        {conti.location ? <div>장소: {conti.location}</div> : null}
        {conti.lighting ? <div>조명: {conti.lighting}</div> : null}
        {conti.timeOfDay ? <div>시간: {conti.timeOfDay}</div> : null}
        {conti.cutType ? <div>컷: {conti.cutType}</div> : null}
        {conti.duration ? <div>길이: {Math.round(conti.duration)}s</div> : null}
      </div>

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
                className="btn-primary btn-sm"
                disabled={!dirty || saving || !onSaveDialogues}
                onClick={() => void handleSave()}
              >
                {saving ? '저장 중…' : '멘트 저장'}
              </button>
            ) : null}
          </div>
          <div className="max-h-[320px] overflow-y-auto rounded border border-huma-bdr">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-huma-bg3 text-huma-t3">
                <tr>
                  <th className="p-1 text-left">#</th>
                  <th className="p-1 text-left">시간</th>
                  <th className="p-1 text-left">카메라</th>
                  <th className="p-1 text-left">액션 / 멘트</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((s, i) => (
                  <tr key={i} className="border-t border-huma-bdr2 align-top">
                    <td className="p-1">{s.shotNumber ?? i + 1}</td>
                    <td className="p-1 whitespace-nowrap">
                      {s.startSec != null && s.endSec != null ? `${s.startSec}–${s.endSec}s` : '—'}
                    </td>
                    <td className="p-1">{s.camera ?? '—'}</td>
                    <td className="p-1">
                      {s.action ? <div>{s.action}</div> : null}
                      {editable ? (
                        <AutoHeightTextarea
                          className={`m-model-select w-full py-1 text-[10px] leading-snug text-huma-warn ${s.action ? 'mt-1' : ''}`}
                          value={drafts[i]?.dialogue ?? ''}
                          placeholder="멘트 없음"
                          onChange={(value) => {
                            setDrafts((prev) =>
                              prev.map((row, idx) => (idx === i ? { ...row, dialogue: value } : row)),
                            );
                          }}
                        />
                      ) : drafts[i]?.dialogue ? (
                        <div className={`text-huma-warn ${s.action ? 'mt-1' : ''}`}>「{drafts[i]!.dialogue}」</div>
                      ) : !s.action ? (
                        <span className="text-huma-t4">—</span>
                      ) : null}
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
