'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  HumaNarrationScriptHistory,
  NarrationAxisType,
  NarrationFormatType,
  NarrationScriptProgress,
  NarrationScriptWorkspace,
} from '@huma/shared';
import {
  NARRATION_AXIS_LABEL,
  NARRATION_FORMAT_LABEL,
  NARRATION_SCRIPT_STATUS_LABEL,
  NARRATION_WORKSPACE_LABEL,
} from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert, appConfirm, appToast } from '@/lib/app-dialog';
import { getLogSocket } from '@/lib/socket';
import {
  mergeNarrationProgress,
  narrationProgressFromItem,
  parseNarrationScriptProgressLog,
} from '@/lib/narration-script-progress';
import { MPanel, MTag } from '@/components/mockup/primitives';
import { VIDEO_PRIMARY_BTN } from '@/components/video/video-content-ui';
import { NarrationGeneratingPanel } from '@/components/narration/narration-generating-panel';

type Tab = 'ready' | 'generating' | 'failed';

interface Props {
  service: NarrationScriptWorkspace;
}

function formatCopyText(item: HumaNarrationScriptHistory): string {
  return `제목: ${item.title}\n\n${item.script_body}`;
}

export function NarrationScriptView({ service }: Props) {
  const [items, setItems] = useState<HumaNarrationScriptHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('ready');
  const [formatType, setFormatType] = useState<NarrationFormatType>('full_cover');
  const [axisType, setAxisType] = useState<NarrationAxisType | 'auto'>('auto');
  const [topicKey, setTopicKey] = useState<string>('');
  const [topics, setTopics] = useState<Array<{ key: string; label: string }>>([]);
  const [nextPick, setNextPick] = useState<{
    format_type: NarrationFormatType;
    axis_type: NarrationAxisType;
    topic_label: string;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [liveProgressById, setLiveProgressById] = useState<
    Record<string, { label: string; percent: number }>
  >({});
  const hadGeneratingRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await api.narrationScriptsList(service);
      setItems(res.items ?? []);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [service]);

  const loadMeta = useCallback(async () => {
    const [topicRes, pickRes] = await Promise.all([
      api.narrationScriptTopics(service),
      api.narrationScriptNextPick(service, formatType).catch(() => null),
    ]);
    setTopics((topicRes.topics ?? []).map((t) => ({ key: t.key, label: t.label })));
    if (pickRes) setNextPick(pickRes);
  }, [service, formatType]);

  const hasGenerating = useMemo(
    () => items.some((i) => i.status === 'script_generating'),
    [items],
  );

  useEffect(() => {
    void load();
    void loadMeta();
  }, [load, loadMeta]);

  useEffect(() => {
    const pollMs = hasGenerating ? 2_000 : 8_000;
    const id = setInterval(() => void load({ silent: true }), pollMs);
    return () => clearInterval(id);
  }, [load, hasGenerating]);

  useEffect(() => {
    const socket = getLogSocket();
    const onLog = (payload: { message?: string; metadata?: Record<string, unknown> }) => {
      const parsed = parseNarrationScriptProgressLog(payload);
      if (!parsed?.historyId) return;
      setLiveProgressById((prev) => ({
        ...prev,
        [parsed.historyId!]: {
          label: parsed.label,
          percent: parsed.percent ?? prev[parsed.historyId!]?.percent ?? 5,
        },
      }));
    };
    socket.on('log', onLog);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off('log', onLog);
    };
  }, []);

  useEffect(() => {
    if (hadGeneratingRef.current && !hasGenerating) {
      void load();
      setLiveProgressById({});
    }
    hadGeneratingRef.current = hasGenerating;
  }, [hasGenerating, load]);

  const filtered = useMemo(() => {
    if (activeTab === 'ready') return items.filter((i) => i.status === 'script_ready');
    if (activeTab === 'generating') return items.filter((i) => i.status === 'script_generating');
    return items.filter((i) => i.status === 'failed');
  }, [items, activeTab]);

  const selected = items.find((i) => i.id === selectedId) ?? filtered[0] ?? null;

  const selectedProgress = useMemo((): NarrationScriptProgress | null => {
    if (!selected || selected.status !== 'script_generating') return null;
    const fromMeta = narrationProgressFromItem(selected);
    return mergeNarrationProgress(fromMeta, liveProgressById[selected.id] ?? null);
  }, [selected, liveProgressById]);

  useEffect(() => {
    if (selected?.status === 'script_ready') {
      setActiveTab('ready');
    }
  }, [selected?.id, selected?.status]);

  useEffect(() => {
    if (selected) {
      setEditTitle(selected.title);
      setEditBody(selected.script_body);
    }
  }, [selected?.id, selected?.title, selected?.script_body]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await api.narrationScriptGenerate({
        workspace: service,
        format_type: formatType,
        axis_type: axisType,
        topic_key: topicKey.trim() || null,
      });
      appToast('나레이션 대본 생성을 시작했습니다');
      setActiveTab('generating');
      await load();
      await loadMeta();
    } catch (e) {
      appAlert((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (mode: 'all' | 'body') => {
    if (!selected) return;
    const text = mode === 'all' ? formatCopyText(selected) : selected.script_body;
    await navigator.clipboard.writeText(text);
    appToast(mode === 'all' ? '제목+대본 복사됨' : '대본 복사됨');
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.narrationScriptUpdate(selected.id, { title: editTitle, script_body: editBody });
      appToast('저장됨');
      await load();
    } catch (e) {
      appAlert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!selected) return;
    if (!(await appConfirm('이 대본을 재생성할까요?'))) return;
    try {
      await api.narrationScriptRegenerate(selected.id);
      appToast('재생성 큐 등록');
      setActiveTab('generating');
      await load();
    } catch (e) {
      appAlert((e as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!(await appConfirm('삭제할까요?'))) return;
    try {
      await api.narrationScriptDelete(selected.id);
      setSelectedId(null);
      await load();
    } catch (e) {
      appAlert((e as Error).message);
    }
  };

  const tabCounts = {
    ready: items.filter((i) => i.status === 'script_ready').length,
    generating: items.filter((i) => i.status === 'script_generating').length,
    failed: items.filter((i) => i.status === 'failed').length,
  };

  const progressForItem = (item: HumaNarrationScriptHistory) => {
    const fromMeta = narrationProgressFromItem(item);
    return mergeNarrationProgress(fromMeta, liveProgressById[item.id] ?? null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <MPanel title={`🎙 새 나레이션 대본 · ${NARRATION_WORKSPACE_LABEL[service]}`}>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-[11px] text-huma-t3">
            포맷
            <select
              className="mt-1 w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-[12px]"
              value={formatType}
              onChange={(e) => setFormatType(e.target.value as NarrationFormatType)}
            >
              <option value="full_cover">{NARRATION_FORMAT_LABEL.full_cover}</option>
              <option value="ranked">{NARRATION_FORMAT_LABEL.ranked}</option>
            </select>
          </label>
          <label className="text-[11px] text-huma-t3">
            축
            <select
              className="mt-1 w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-[12px]"
              value={axisType}
              onChange={(e) => setAxisType(e.target.value as NarrationAxisType | 'auto')}
            >
              <option value="auto">자동 (순환)</option>
              <option value="zodiac">{NARRATION_AXIS_LABEL.zodiac}</option>
              <option value="constellation">{NARRATION_AXIS_LABEL.constellation}</option>
              <option value="generation">{NARRATION_AXIS_LABEL.generation}</option>
            </select>
          </label>
          <label className="text-[11px] text-huma-t3 md:col-span-2">
            주제 (자동 순환 / 수동)
            <select
              className="mt-1 w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-[12px]"
              value={topicKey}
              onChange={(e) => setTopicKey(e.target.value)}
            >
              <option value="">자동 순환</option>
              {topics.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {nextPick ? (
          <p className="mt-2 text-[10px] text-huma-t4">
            다음 자동 pick 예시: {NARRATION_FORMAT_LABEL[nextPick.format_type]} ×{' '}
            {NARRATION_AXIS_LABEL[nextPick.axis_type]} × 「{nextPick.topic_label}」 (14일 순환)
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={VIDEO_PRIMARY_BTN} disabled={generating} onClick={() => void handleGenerate()}>
            {generating ? '등록 중…' : '대본 자동 생성'}
          </button>
          {service === 'fortune82' ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => void api.fortune82ProductsSync().then(() => appToast('포춘82 상품 sync 요청'))}
            >
              포춘82 상품 sync
            </button>
          ) : null}
        </div>
      </MPanel>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_1fr]">
        <MPanel title="목록" className="m-panel-fill min-h-0">
          <div className="mb-2 flex gap-1">
            {(
              [
                ['ready', '검토 대기'],
                ['generating', '생성 중'],
                ['failed', '실패'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rounded px-2 py-1 text-[10px] ${activeTab === key ? 'bg-huma-accent/20 text-huma-accent' : 'text-huma-t3'}`}
                onClick={() => setActiveTab(key)}
              >
                {label} ({tabCounts[key]})
              </button>
            ))}
          </div>
          <ul className="max-h-[480px] space-y-1 overflow-y-auto">
            {loading ? (
              <li className="py-6 text-center text-[11px] text-huma-t3">불러오는 중…</li>
            ) : filtered.length ? (
              filtered.map((item) => {
                const prog =
                  item.status === 'script_generating' ? progressForItem(item) : null;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`w-full rounded border px-2 py-2 text-left ${selected?.id === item.id ? 'border-huma-accent bg-huma-accent/10' : 'border-huma-bdr'}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div className="truncate text-[11px] font-medium">{item.title || item.topic_label}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1 text-[9px] text-huma-t4">
                        <MTag tone="idle">{NARRATION_FORMAT_LABEL[item.format_type]}</MTag>
                        <span>{NARRATION_AXIS_LABEL[item.axis_type]}</span>
                      </div>
                      {prog ? (
                        <div className="mt-1.5">
                          <div className="mb-0.5 flex justify-between font-mono text-[8px] text-huma-t4">
                            <span className="truncate pr-1">{prog.label}</span>
                            <span className="shrink-0 text-huma-accent">{prog.percent}%</span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-huma-bg3">
                            <div
                              className="h-full rounded-full bg-huma-accent transition-[width] duration-500"
                              style={{ width: `${prog.percent}%` }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="py-6 text-center text-[11px] text-huma-t3">항목 없음</li>
            )}
          </ul>
        </MPanel>

        <MPanel title="📋 브루 붙여넣기용 대본" className="m-panel-fill min-h-0">
          {selected ? (
            selected.status === 'script_generating' && selectedProgress ? (
              <NarrationGeneratingPanel topicLabel={selected.topic_label} progress={selectedProgress} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap gap-2 text-[10px] text-huma-t4">
                  <MTag tone={selected.status === 'script_ready' ? 'ok' : selected.status === 'failed' ? 'err' : 'warn'}>
                    {NARRATION_SCRIPT_STATUS_LABEL[selected.status]}
                  </MTag>
                  <span>{selected.topic_label}</span>
                </div>
                {selected.status === 'failed' && selected.error_message ? (
                  <p className="text-[11px] text-red-400">{selected.error_message}</p>
                ) : null}
                <label className="text-[11px] text-huma-t3">
                  제목
                  <input
                    className="mt-1 w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-[12px]"
                    value={editTitle}
                    disabled={selected.status === 'script_generating'}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </label>
                <label className="min-h-0 flex flex-1 flex-col text-[11px] text-huma-t3">
                  나레이션 대본
                  <textarea
                    className="mt-1 min-h-[280px] flex-1 resize-y rounded border border-huma-bdr bg-huma-bg2 px-2 py-2 font-mono text-[12px] leading-relaxed"
                    value={editBody}
                    disabled={selected.status === 'script_generating'}
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={VIDEO_PRIMARY_BTN} disabled={selected.status !== 'script_ready'} onClick={() => void handleCopy('all')}>
                    제목+대본 복사
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={selected.status !== 'script_ready'} onClick={() => void handleCopy('body')}>
                    대본만 복사
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={saving || selected.status !== 'script_ready'} onClick={() => void handleSave()}>
                    저장
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={selected.status === 'script_generating'} onClick={() => void handleRegenerate()}>
                    재생성
                  </button>
                  <button type="button" className="btn-ghost btn-sm text-red-400" disabled={selected.status === 'script_generating'} onClick={() => void handleDelete()}>
                    삭제
                  </button>
                </div>
              </div>
            )
          ) : (
            <p className="py-12 text-center text-[12px] text-huma-t3">목록에서 대본을 선택하세요</p>
          )}
        </MPanel>
      </div>
    </div>
  );
}
