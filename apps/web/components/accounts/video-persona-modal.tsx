'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HumaAccount, HumaVideoContentHistory, VideoPersonaConfig, Workspace } from '@huma/shared';
import { hasStoredVideoPersona, getVideoPersonaSectionGuide, serializeVideoPersonaText } from '@huma/shared';
import { api } from '@/lib/api';

interface VideoPersonaModalProps {
  account: HumaAccount;
  open: boolean;
  onClose: () => void;
}

export function VideoPersonaModal({ account, open, onClose }: VideoPersonaModalProps) {
  const ws = account.workspace as Workspace;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<HumaVideoContentHistory[]>([]);
  const [defaults, setDefaults] = useState<VideoPersonaConfig | null>(null);
  const [personaText, setPersonaText] = useState('');
  const [pananaChars, setPananaChars] = useState<
    Array<{ id: string; name: string; description?: string | null; appearanceCount?: number }>
  >([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [personaRes, hist] = await Promise.all([
        api.getAccountVideoPersona(account.id),
        api.videoContentHistory(account.id),
      ]);
      setDefaults(personaRes.defaults as VideoPersonaConfig);
      const stored = personaRes.videoPersona as Partial<VideoPersonaConfig> | null;
      setPersonaText(
        hasStoredVideoPersona(stored) ? serializeVideoPersonaText(stored!, ws) : '',
      );
      setHistory(hist);

      if (ws === 'panana') {
        const pan = await api.pananaCharacters(account.id);
        setPananaChars(pan.characters ?? []);
        setLastSyncedAt(pan.lastSyncedAt ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '로드 실패');
    } finally {
      setLoading(false);
    }
  }, [account.id, ws]);

  useEffect(() => {
    if (open) void load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [open, load]);

  const handleSave = async (): Promise<{ ok: boolean; missingSections: string[] }> => {
    setSaving(true);
    setError('');
    try {
      const res = await api.updateAccountVideoPersona(account.id, { rawText: personaText });
      const parts: string[] = ['저장 완료'];
      if (res.missingSections.length) {
        parts.push(`비어 있는 섹션: ${res.missingSections.join(', ')}`);
      }
      if (res.unknownSections?.length) {
        parts.push(`인식되지 않은 섹션: ${res.unknownSections.join(', ')}`);
      }
      showToast(parts.join(' · '));
      return { ok: true, missingSections: res.missingSections };
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
      return { ok: false, missingSections: [] };
    } finally {
      setSaving(false);
    }
  };

  const handlePananaSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const result = await api.syncPananaCharacters();
      if (result.error) {
        setError(`동기화 실패: ${result.error}`);
      } else {
        showToast(`캐릭터 ${result.synced}건 동기화 완료`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '동기화 실패');
    } finally {
      setSyncing(false);
    }
  };

  if (!open) return null;

  return (
    <div className="m-modal-bg open" onClick={onClose} role="presentation">
      <div
        className="m-modal m-modal-queue max-h-[90vh] max-w-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="m-modal-t">🎬 영상 페르소나 · {account.name}</div>
        <p className="mb-3 text-[12px] text-huma-t3">
          ## 섹션별 페르소나를 붙여넣으면 저장 시 자동 분리됩니다. 매 영상마다 LLM이 새 시나리오를
          창작합니다.
          {ws === 'panana' ? ' 파나나는 관계축·상황축을 함께 사용합니다.' : null}
        </p>

        {loading ? (
          <p className="text-sm text-huma-t3">로딩…</p>
        ) : (
          <>
            {error ? <p className="mb-2 text-xs text-huma-err">{error}</p> : null}
            {toast ? (
              <p className="mb-2 rounded bg-[var(--ok-bg)] px-2 py-1.5 text-[11px] text-huma-ok" role="status">
                {toast}
              </p>
            ) : null}

            <p className="mb-2 text-[11px] leading-relaxed text-huma-t3">
              아래 형식으로 전체 페르소나를 작성해서 붙여넣으세요.
              <br />
              <span className="font-mono text-huma-t2">{getVideoPersonaSectionGuide(ws)}</span>
              <br />
              {ws === 'panana'
                ? '파나나: 7개 섹션(상황축 포함).'
                : '연운·퀴즈오아시스: 6개 섹션 필수. 상황축은 선택(입력 시 저장만).'}
            </p>

            <textarea
              className="m-modal-input m-modal-textarea mb-3 min-h-[360px] font-mono text-[11px] leading-relaxed"
              value={personaText}
              onChange={(e) => setPersonaText(e.target.value)}
              placeholder={
                ws === 'panana'
                  ? `## 관계축\n캐릭터-일반인\n...\n\n## 상황축\n카페 대화\n...\n\n## 감정곡선\n...\n\n## 펀치라인 메커니즘\n...\n\n## 컷 구성\n...\n\n## 샷 구조\n...\n\n## 서비스 제약\n...`
                  : `## 관계축\n연인\n...\n\n## 감정곡선\n...\n\n## 펀치라인 메커니즘\n...\n\n## 컷 구성\n...\n\n## 샷 구조\n...\n\n## 서비스 제약\n...`
              }
              rows={15}
              spellCheck={false}
            />

            {defaults && !personaText.trim() ? (
              <p className="mb-3 text-[10px] text-huma-t4">
                저장된 페르소나가 없습니다. 비워두면 워크스페이스 기본값({ws})이 생성 시 사용됩니다.
              </p>
            ) : null}

            {ws === 'panana' ? (
              <div className="m-panel mb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-semibold text-huma-t">파나나 캐릭터 캐시</div>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => void handlePananaSync()} disabled={syncing}>
                    {syncing ? '동기화 중…' : '지금 동기화'}
                  </button>
                </div>
                <p className="text-[10px] text-huma-t3">
                  마지막 동기화: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('ko-KR') : '—'}
                </p>
                {pananaChars.length ? (
                  <ul className="max-h-[120px] space-y-1 overflow-y-auto text-[11px]">
                    {pananaChars.map((c) => (
                      <li key={c.id} className="rounded border border-huma-bdr px-2 py-1">
                        <span className="font-semibold">{c.name}</span>
                        <span className="ml-2 text-huma-t3">최근 20건 {c.appearanceCount ?? 0}회</span>
                        {c.description ? (
                          <div className="truncate text-huma-t3">{c.description.slice(0, 80)}…</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-huma-t3">활성 캐릭터 없음 — PANANA_CHARACTER_API_URL 확인</p>
                )}
              </div>
            ) : null}

            <div className="mb-3">
              <div className="mb-1 text-[12px] font-semibold text-huma-t">최근 10건 영상 히스토리</div>
              {history.length ? (
                <div className="max-h-[160px] overflow-y-auto rounded border border-huma-bdr">
                  <table className="w-full text-[10px]">
                    <thead className="sticky top-0 bg-huma-bg3 text-huma-t3">
                      <tr>
                        <th className="p-1 text-left">일시</th>
                        <th className="p-1 text-left">상태</th>
                        <th className="p-1 text-left">유사도</th>
                        <th className="p-1 text-left">컷/길이</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id} className="border-t border-huma-bdr2">
                          <td className="p-1">{new Date(h.created_at).toLocaleDateString('ko-KR')}</td>
                          <td className="p-1">{h.status}</td>
                          <td className="p-1">{h.similarity_score?.toFixed?.(3) ?? '—'}</td>
                          <td className="p-1">
                            {h.cut_type}/{h.duration}s
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[11px] text-huma-t3">아직 생성된 영상 없음</p>
              )}
            </div>

            <div className="m-modal-foot mt-3 flex-wrap gap-2">
              <button type="button" className="btn-primary flex-[2] py-2" onClick={() => void handleSave()} disabled={saving}>
                {saving ? '저장 중…' : '설정 저장'}
              </button>
              <button type="button" className="btn-ghost flex-1 py-2" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
