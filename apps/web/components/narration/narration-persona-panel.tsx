'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NarrationScriptWorkspace } from '@huma/shared';
import { NARRATION_WORKSPACE_LABEL } from '@huma/shared';
import {
  NARRATION_PERSONA_SECTION_GUIDE,
  resolveNarrationPersonaDefaultText,
} from '@/lib/narration-persona-default';
import { api } from '@/lib/api';
import { appAlert, appConfirm, appToast } from '@/lib/app-dialog';
import { MPanel } from '@/components/mockup/primitives';

interface Props {
  service: NarrationScriptWorkspace;
}

export function NarrationPersonaPanel({ service }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [personaText, setPersonaText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [resetFlash, setResetFlash] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const builtinDefault = useMemo(() => resolveNarrationPersonaDefaultText(service), [service]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.narrationScriptPersonaGet(service);
      const loaded =
        (res.personaText ?? '').trim() ||
        (res.defaultPersonaText ?? '').trim() ||
        builtinDefault;
      setPersonaText(loaded);
      setSavedText(loaded);
      setUpdatedAt(res.updatedAt ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '페르소나 불러오기 실패';
      setLoadError(msg);
      setPersonaText(builtinDefault);
      setSavedText('');
      setUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }, [service, builtinDefault]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = personaText !== savedText;
  const summary = useMemo(() => {
    if (loading) return '불러오는 중…';
    if (loadError) return '오프라인 기본값 (저장하려면 API 확인)';
    if (dirty) return '저장되지 않은 변경';
    if (updatedAt) {
      return `저장됨 · ${new Date(updatedAt).toLocaleString('ko-KR')}`;
    }
    return '기본 페르소나';
  }, [dirty, loadError, loading, updatedAt]);

  const focusTextarea = () => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.scrollTop = 0;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.narrationScriptPersonaUpdate(service, personaText);
      setSavedText(personaText);
      setUpdatedAt(res.updatedAt ?? new Date().toISOString());
      setLoadError('');
      appToast('브루 MC 페르소나를 저장했습니다');
    } catch (e) {
      await appAlert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!(await appConfirm('기본 페르소나로 되돌릴까요? 저장 버튼을 눌러야 DB에 반영됩니다.'))) return;
    const next = resolveNarrationPersonaDefaultText(service);
    if (!next.trim()) {
      await appAlert('기본 페르소나를 불러오지 못했습니다. dev 서버를 재시작해 주세요.');
      return;
    }
    setOpen(true);
    setPersonaText(next);
    setResetFlash(true);
    window.setTimeout(() => setResetFlash(false), 1200);
    focusTextarea();
    appToast('기본 페르소나를 불러왔습니다. 저장을 눌러 반영하세요.', { durationMs: 2500 });
  };

  return (
    <MPanel
      title={`🎭 브루 MC 페르소나 · ${NARRATION_WORKSPACE_LABEL[service]}`}
      action={
        <button
          type="button"
          className="btn-ghost btn-sm text-[11px]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '접기 ▲' : '펼치기 ▼'}
        </button>
      }
    >
      <p className="text-[10px] text-huma-t4">
        대본 자동 생성 시 Claude <span className="font-mono text-huma-t3">system</span>에 주입됩니다. 주제·축·
        시점은 매번 자동으로 붙습니다.
        <span className="ml-2 text-huma-t3">{summary}</span>
        {dirty ? <span className="ml-1 text-huma-warn">●</span> : null}
      </p>
      {loadError ? <p className="mt-1 text-[10px] text-huma-err">{loadError}</p> : null}

      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] leading-relaxed text-huma-t3">
            권장 섹션: <span className="font-mono text-huma-t2">{NARRATION_PERSONA_SECTION_GUIDE}</span>
            <br />
            CTA는 참고만 — 대본 본문에는 넣지 않습니다(시스템 append). 스토리형 영상 페르소나와 <strong>별도</strong>
            입니다.
          </p>
          <textarea
            ref={textareaRef}
            className={`min-h-[280px] w-full resize-y rounded border bg-huma-bg2 px-2 py-2 font-mono text-[11px] leading-relaxed text-huma-t transition-colors ${
              resetFlash ? 'border-huma-warn ring-1 ring-huma-warn/40' : 'border-huma-bdr'
            }`}
            value={personaText}
            onChange={(e) => setPersonaText(e.target.value)}
            disabled={loading && !personaText}
            spellCheck={false}
            placeholder={builtinDefault.slice(0, 120)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={loading || saving || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? '저장 중…' : '페르소나 저장'}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={saving}
              onClick={() => void handleReset()}
            >
              기본값 복원
            </button>
            <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={() => void load()}>
              새로고침
            </button>
            <span className="self-center text-[10px] text-huma-t4">{personaText.length}자</span>
          </div>
        </div>
      ) : null}
    </MPanel>
  );
}
