'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  parseQuizImagePrompts,
  normalizeQuizImagePrefix,
  type QuizImageParseResult,
} from '@huma/shared';
import { api } from '@/lib/api';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { MPanel, MTag } from '@/components/mockup/primitives';
import { cn } from '@/lib/constants';

type GenStatus = 'idle' | 'pending' | 'generating' | 'done' | 'error';

interface GenRow {
  key: string;
  questionNumber: number;
  choiceId: string | null;
  prompt: string;
  filename: string;
  isFaceQuestion: boolean;
  choiceCount: number;
  status: GenStatus;
  imageUrl?: string;
  error?: string;
}

function rowKey(item: { questionNumber: number; choiceId: string | null; filename: string }) {
  return `${item.questionNumber}-${item.choiceId ?? 'face'}-${item.filename}`;
}

function toGenRows(parsed: QuizImageParseResult): GenRow[] {
  return parsed.items.map((item) => ({
    key: rowKey(item),
    questionNumber: item.questionNumber,
    choiceId: item.choiceId,
    prompt: item.prompt,
    filename: item.filename,
    isFaceQuestion: item.isFaceQuestion,
    choiceCount: item.choiceCount,
    status: 'idle' as GenStatus,
  }));
}

const SETTINGS_CHIPS = [
  { label: 'GPT Image 2', tone: 'blue' as const },
  { label: '1:1', tone: 'idle' as const },
  { label: '1K', tone: 'idle' as const },
  { label: 'Low', tone: 'idle' as const },
  { label: '×1', tone: 'idle' as const },
];

export function QuizImageGenView() {
  const [prefix, setPrefix] = useState('');
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<QuizImageParseResult | null>(null);
  const [rows, setRows] = useState<GenRow[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [abortGen, setAbortGen] = useState(false);

  useEffect(() => {
    api
      .quizImageConfig()
      .then((c) => {
        setConfigured(c.configured);
        setConfigError(c.configured ? null : 'EVOLINK_API_KEY가 i7 apps/server/.env에 없습니다. 설정 후 pm2 restart huma-server 하세요.');
      })
      .catch((e: Error) => {
        setConfigured(null);
        const msg = e.message ?? '';
        if (msg.includes('404') || msg.includes('경로 없음') || msg.includes('not found')) {
          setConfigError(
            'i7 HUMA 서버에 퀴즈 이미지 API가 아직 배포되지 않았습니다. i7에서 git pull → npm run build --workspace=@huma/server → pm2 restart huma-server 후 다시 시도하세요.',
          );
        } else if (msg.includes('연결') || msg.includes('502')) {
          setConfigError(`백엔드 API 연결 실패 — ${msg}`);
        } else {
          setConfigError(msg || 'EvoLink 설정 확인 API 호출 실패');
        }
      });
  }, []);

  const normalizedPrefix = useMemo(() => normalizeQuizImagePrefix(prefix), [prefix]);

  const runParse = useCallback(() => {
    if (!normalizedPrefix) {
      setParsed(null);
      setRows([]);
      return;
    }
    const result = parseQuizImagePrompts(raw, normalizedPrefix);
    setParsed(result);
    setRows(toGenRows(result));
  }, [raw, normalizedPrefix]);

  useEffect(() => {
    const t = setTimeout(runParse, 400);
    return () => clearTimeout(t);
  }, [runParse]);

  const doneCount = rows.filter((r) => r.status === 'done').length;
  const errorCount = rows.filter((r) => r.status === 'error').length;
  const progressPct = rows.length ? Math.round((doneCount / rows.length) * 100) : 0;

  const updateRow = (key: string, patch: Partial<GenRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const generateOne = async (row: GenRow) => {
    updateRow(row.key, { status: 'generating', error: undefined });
    try {
      const res = await api.quizImageGenerate({
        prompt: row.prompt,
        filename: row.filename,
        questionNumber: row.questionNumber,
        choiceId: row.choiceId,
      });
      updateRow(row.key, { status: 'done', imageUrl: res.imageUrl });
      return true;
    } catch (e) {
      updateRow(row.key, { status: 'error', error: (e as Error).message });
      return false;
    }
  };

  const generateAll = async () => {
    if (!rows.length || generating) return;
    setGenerating(true);
    setAbortGen(false);
    const pending = rows.filter((r) => r.status !== 'done');
    for (const row of pending) {
      if (abortGen) break;
      if (row.status === 'done') continue;
      await generateOne(row);
    }
    setGenerating(false);
  };

  const downloadOne = async (row: GenRow) => {
    if (!row.imageUrl) return;
    const blob = await api.quizImageDownloadBlob(row.imageUrl, row.filename);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = row.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadZip = async () => {
    const done = rows.filter((r) => r.status === 'done' && r.imageUrl);
    if (!done.length) return;
    setZipLoading(true);
    try {
      const blob = await api.quizImageZip(
        done.map((r) => ({ url: r.imageUrl!, filename: r.filename })),
        `${normalizedPrefix || 'quiz-images'}.zip`.replace(/\.zip$/i, '') + '.zip',
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${normalizedPrefix || 'quiz-images'}.zip`.replace(/_+$/, '') + '.zip';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipLoading(false);
    }
  };

  const apiReady = configured === true;

  return (
    <div className="animate-fadeIn space-y-3">
      {configError && (
        <div className="rounded-lg border border-huma-warn/40 bg-[var(--warn-bg)] px-3 py-2 text-[12px] text-huma-warn whitespace-pre-wrap">
          {configError}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(280px,340px)_1fr]">
        <div className="space-y-3">
          <MPanel title="입력">
            <label className="mb-1 block text-[11px] font-semibold text-huma-t2">파일명 프리픽스</label>
            <input
              type="text"
              className="mb-1 w-full rounded-md border border-huma-bdr bg-huma-bg3 px-2.5 py-2 font-mono text-[12px] text-huma-t outline-none focus:border-huma-acc"
              placeholder="p3_test_solo_drinking_type_"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <p className="mb-3 font-mono text-[10px] text-huma-t3">
              예: {normalizedPrefix || 'prefix_'}q1_a.png
            </p>

            <div className="mb-3 flex flex-wrap gap-1">
              {SETTINGS_CHIPS.map((chip) => (
                <MTag key={chip.label} tone={chip.tone}>
                  {chip.label}
                </MTag>
              ))}
            </div>

            <label className="mb-1 block text-[11px] font-semibold text-huma-t2">문항·프롬프트 붙여넣기</label>
            <textarea
              className="min-h-[320px] w-full resize-y rounded-md border border-huma-bdr bg-huma-bg3 px-2.5 py-2 text-[11.5px] leading-relaxed text-huma-t outline-none focus:border-huma-acc"
              placeholder="Q1. …&#10;• A. 🖼️ …&#10;…&#10;[Q1 선택지 이미지 프롬프트]&#10;• A 이미지: …"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </MPanel>
        </div>

        <div className="space-y-3">
          <MPanel
            title={
              parsed && parsed.totalImages > 0 ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>분석 결과</span>
                  <MTag tone="blue">{parsed.questions.length}문항</MTag>
                  <MTag tone="idle">{parsed.totalImages}장</MTag>
                  <MTag tone="idle">{parsed.choiceType}</MTag>
                </span>
              ) : (
                '분석 결과'
              )
            }
            action={
              parsed && parsed.totalImages > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="btn-primary px-2.5 py-1 text-[11px]"
                    disabled={generating || !apiReady}
                    onClick={() => void generateAll()}
                  >
                    {generating ? `생성 중 ${doneCount}/${rows.length}` : '일괄 생성'}
                  </button>
                  {generating && (
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[10px]"
                      onClick={() => setAbortGen(true)}
                    >
                      중지
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost px-2.5 py-1 text-[11px]"
                    disabled={doneCount === 0 || zipLoading}
                    onClick={() => void downloadZip()}
                  >
                    {zipLoading ? 'ZIP…' : `전체 다운로드 (${doneCount})`}
                  </button>
                </div>
              ) : null
            }
          >
            {!normalizedPrefix && raw.trim() && (
              <EmptyPanel message="파일명 프리픽스를 입력하면 분석이 시작됩니다." />
            )}
            {normalizedPrefix && !parsed?.totalImages && !raw.trim() && (
              <EmptyPanel message="왼쪽에 퀴즈 문항·선택지·이미지 프롬프트를 붙여넣으세요." />
            )}
            {parsed && parsed.errors.length > 0 && (
              <div className="mb-3 space-y-1 rounded-md border border-huma-warn/30 bg-[var(--warn-bg)] px-2.5 py-2 text-[11px] text-huma-warn">
                {parsed.errors.map((err) => (
                  <div key={err}>⚠ {err}</div>
                ))}
              </div>
            )}

            {parsed && parsed.totalImages > 0 && (
              <>
                {generating || doneCount > 0 ? (
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-[10px] text-huma-t3">
                      <span>
                        완료 {doneCount}/{rows.length}
                        {errorCount > 0 && <span className="ml-2 text-huma-err">실패 {errorCount}</span>}
                      </span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-huma-bg3">
                      <div
                        className="h-full rounded-full bg-huma-acc transition-all duration-300"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-3">
                  {parsed.questions.map((q) => (
                    <div
                      key={q.questionNumber}
                      className="rounded-lg border border-huma-bdr bg-huma-bg2/60"
                    >
                      <div className="flex flex-wrap items-center gap-2 border-b border-huma-bdr2 px-3 py-2">
                        <span className="font-mono text-[12px] font-bold text-huma-acc">Q{q.questionNumber}</span>
                        {q.isFaceQuestion ? (
                          <MTag tone="warn">총면</MTag>
                        ) : (
                          <MTag tone="idle">{q.choiceCount}지선다</MTag>
                        )}
                        {q.questionText && (
                          <span className="min-w-0 flex-1 truncate text-[11.5px] text-huma-t2">{q.questionText}</span>
                        )}
                      </div>
                      <div className="grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-4">
                        {q.images.map((img) => {
                          const row = rows.find((r) => r.key === rowKey(img));
                          if (!row) return null;
                          return (
                            <ImageGenCard
                              key={row.key}
                              row={row}
                              generating={generating}
                              apiReady={apiReady}
                              onGenerate={() => void generateOne(row)}
                              onDownload={() => void downloadOne(row)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </MPanel>
        </div>
      </div>
    </div>
  );
}

function ImageGenCard({
  row,
  generating,
  apiReady,
  onGenerate,
  onDownload,
}: {
  row: GenRow;
  generating: boolean;
  apiReady: boolean;
  onGenerate: () => void;
  onDownload: () => void;
}) {
  const statusTone =
    row.status === 'done' ? 'ok' : row.status === 'error' ? 'err' : row.status === 'generating' ? 'live' : 'idle';
  const statusLabel =
    row.status === 'done'
      ? '완료'
      : row.status === 'error'
        ? '실패'
        : row.status === 'generating'
          ? '생성 중'
          : row.status === 'pending'
            ? '대기'
            : '미생성';

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-huma-bdr bg-huma-bg3">
      <div className="relative aspect-square bg-huma-bg2">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.imageUrl} alt={row.filename} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-huma-t3">
            {row.choiceId ? (
              <span className="font-mono text-[22px] font-bold text-huma-t4">{row.choiceId}</span>
            ) : (
              <span className="text-[11px]">총면</span>
            )}
            {row.status === 'generating' && (
              <span className="animate-pulse text-huma-acc">EvoLink 생성 중…</span>
            )}
          </div>
        )}
        <div className="absolute left-1.5 top-1.5">
          <MTag tone={statusTone}>{statusLabel}</MTag>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="font-mono text-[10px] font-semibold text-huma-acc">{row.filename}</div>
        <p className="line-clamp-3 flex-1 text-[10px] leading-snug text-huma-t3" title={row.prompt}>
          {row.prompt}
        </p>
        {row.error && <p className="text-[10px] text-huma-err">{row.error}</p>}
        <div className="flex gap-1">
          <button
            type="button"
            className={cn(
              'flex-1 rounded border px-1.5 py-1 text-[10px] transition',
              row.status === 'done'
                ? 'border-huma-bdr text-huma-t3'
                : 'border-huma-acc/40 text-huma-acc hover:bg-[var(--glow)]',
            )}
            disabled={generating || !apiReady || row.status === 'generating'}
            onClick={onGenerate}
          >
            {row.status === 'error' ? '재시도' : row.status === 'done' ? '재생성' : '생성'}
          </button>
          <button
            type="button"
            className="flex-1 rounded border border-huma-bdr px-1.5 py-1 text-[10px] text-huma-t2 hover:bg-huma-bg2 disabled:opacity-40"
            disabled={!row.imageUrl}
            onClick={onDownload}
          >
            다운로드
          </button>
        </div>
      </div>
    </div>
  );
}
