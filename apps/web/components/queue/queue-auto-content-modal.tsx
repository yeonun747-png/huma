'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { buildScheduledAt } from '@/lib/queue-repeat';
import type { QueuePrefill } from '@/lib/queue-prefill';
import { formatScheduleLabel } from './job-schedule-form';

export interface AutoContentFormValues {
  title: string;
  source_url: string;
  synopsis: string;
  content_type: 'A' | 'B' | 'auto';
  auto_schedule: boolean;
  screenshot_base64?: string;
  schedule_time: string;
}

interface QueueAutoContentModalProps {
  open: boolean;
  editJob?: HumaJob | null;
  prefill?: QueuePrefill | null;
  onClose: () => void;
  onSubmit: (values: AutoContentFormValues) => Promise<void>;
  onPreview?: (values: AutoContentFormValues) => Promise<void>;
}

const EMPTY_FORM: AutoContentFormValues = {
  title: '',
  source_url: '',
  synopsis: '',
  content_type: 'auto',
  auto_schedule: true,
  schedule_time: '10:00',
};

function extractScheduleTime(iso?: string): string {
  if (!iso) return '10:00';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function jobToForm(job: HumaJob): AutoContentFormValues {
  const contentType: AutoContentFormValues['content_type'] = job.content_type_auto
    ? 'auto'
    : job.content_type === 'B'
      ? 'B'
      : 'A';

  return {
    title: job.title ?? '',
    source_url: job.link_url ?? '',
    synopsis: job.content ?? '',
    content_type: contentType,
    auto_schedule: job.auto_scheduled ?? true,
    screenshot_base64: job.image_urls?.[0],
    schedule_time: extractScheduleTime(job.scheduled_at),
  };
}

export function QueueAutoContentModal({ open, editJob, prefill, onClose, onSubmit, onPreview }: QueueAutoContentModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit = Boolean(editJob);
  const editable = !editJob || ['pending', 'scheduled', 'paused'].includes(editJob.status);

  const [form, setForm] = useState<AutoContentFormValues>(EMPTY_FORM);
  const [screenshotName, setScreenshotName] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editJob) {
      setForm(jobToForm(editJob));
      setScreenshotName(editJob.image_urls?.[0] ? '기존 캡처' : '');
    } else if (prefill) {
      setForm({
        ...EMPTY_FORM,
        title: prefill.title,
        source_url: prefill.source_url,
      });
      setScreenshotName('');
    } else {
      setForm(EMPTY_FORM);
      setScreenshotName('');
    }
    setPreviewOpen(false);
    setError('');
  }, [open, editJob, prefill]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  if (!open) return null;

  const handleFile = (file?: File | null) => {
    if (!file || !editable) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? '');
      setForm((f) => ({ ...f, screenshot_base64: data }));
      setScreenshotName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handlePreview = async () => {
    if (!form.title.trim() || !form.source_url.trim()) {
      setError('① 제목과 ② URL은 필수 입력 항목입니다.');
      return;
    }
    if (!onPreview || isEdit) return;
    setError('');
    setLoading(true);
    try {
      await onPreview(form);
      setForm(EMPTY_FORM);
      setScreenshotName('');
      setPreviewOpen(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '검증 등록 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.source_url.trim()) {
      setError('① 제목과 ② URL은 필수 입력 항목입니다.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onSubmit(form);
      if (!isEdit) {
        setForm(EMPTY_FORM);
        setScreenshotName('');
        setPreviewOpen(false);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : isEdit ? '저장 실패' : '등록 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="m-modal-bg open" onClick={onClose} role="presentation">
      <div className="m-modal m-modal-queue" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="m-modal-t">{isEdit ? '✨ AI 자동 콘텐츠 수정' : '✨ AI 자동 콘텐츠 생성 + 발행'}</div>

        {isEdit && editJob && (
          <div className="mb-3 rounded-md border border-huma-bdr bg-huma-bg3 px-3 py-2 text-xs text-huma-t3">
            <span className="font-mono text-huma-t2">{editJob.status}</span>
            {editJob.scheduled_at ? (
              <>
                {' · '}
                <span className="text-huma-acc">{formatScheduleLabel(editJob.scheduled_at)}</span>
              </>
            ) : null}
            {!editable && (
              <span className="ml-2 text-huma-warn">진행 중·완료·실패 작업은 저장할 수 없습니다</span>
            )}
          </div>
        )}

        <div className="m-ai-engine-row">
          <div className="m-ai-engine main">
            <div className="m-ai-engine-tag">MAIN</div>
            <div className="m-ai-engine-name">Claude Sonnet 4.6</div>
            <div className="m-ai-engine-sub">블로그·소셜·영상 프롬프트</div>
          </div>
          <div className="m-ai-engine sub">
            <div className="m-ai-engine-tag">SUB</div>
            <div className="m-ai-engine-name">Claude Haiku 4.5</div>
            <div className="m-ai-engine-sub">타입·모델·스케줄 자동판단</div>
          </div>
        </div>

        <div className="m-modal-field">
          <div className="m-modal-label">콘텐츠 타입</div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!editable}
              className={`flex-1 rounded-md border px-3 py-2 text-left text-xs ${form.content_type === 'auto' ? 'border-huma-acc bg-huma-glow text-huma-acc' : 'border-huma-bdr text-huma-t3'}`}
              onClick={() => setForm((f) => ({ ...f, content_type: 'auto' }))}
            >
              <div className="font-semibold text-huma-t">자동 판단</div>
              <div>Haiku가 A/B · 영상모델 결정</div>
            </button>
            <button
              type="button"
              disabled={!editable}
              className={`flex-1 rounded-md border px-3 py-2 text-left text-xs ${form.content_type === 'A' ? 'border-huma-acc bg-huma-glow text-huma-acc' : 'border-huma-bdr text-huma-t3'}`}
              onClick={() => setForm((f) => ({ ...f, content_type: 'A' }))}
            >
              <div className="font-semibold text-huma-t">타입 A</div>
              <div>텍스트 + 이미지</div>
            </button>
            <button
              type="button"
              disabled={!editable}
              className={`flex-1 rounded-md border px-3 py-2 text-left text-xs ${form.content_type === 'B' ? 'border-huma-acc bg-huma-glow text-huma-acc' : 'border-huma-bdr text-huma-t3'}`}
              onClick={() => setForm((f) => ({ ...f, content_type: 'B' }))}
            >
              <div className="font-semibold text-huma-t">타입 B</div>
              <div>텍스트 + 이미지 + 영상</div>
            </button>
          </div>
        </div>

        <div className="m-modal-field">
          <div className="m-modal-label">① 포스팅 제목 <span className="text-huma-err">필수</span></div>
          <input
            className="m-modal-input"
            placeholder="예: 2026년 병오년 사주 총운 분석"
            value={form.title}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className="m-modal-field">
          <div className="m-modal-label">② 관련 URL <span className="text-huma-err">필수 — Claude가 직접 읽고 이해</span></div>
          <input
            className="m-modal-input"
            placeholder="https://yeonun.ai/fortune/2026"
            value={form.source_url}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, source_url: e.target.value }))}
          />
        </div>

        <div className="m-modal-field">
          <div className="m-modal-label">③ 서비스 화면 캡처 <span className="text-huma-t3">선택 — Claude 비전으로 분석</span></div>
          <button
            type="button"
            className="m-modal-drop m-modal-drop-screenshot"
            disabled={!editable}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFile(e.dataTransfer.files[0]);
            }}
          >
            {form.screenshot_base64 ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.screenshot_base64}
                  alt={screenshotName || '서비스 화면 캡처'}
                  className="m-modal-drop-screenshot-img"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewOpen(true);
                  }}
                />
                <span className="m-modal-drop-screenshot-hint">클릭하여 크게 보기 · 드래그로 교체</span>
              </>
            ) : (
              <>
                <div className="text-lg">📸</div>
                <div className="text-xs text-huma-t3">PNG·JPG 드래그 또는 클릭</div>
              </>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        </div>

        {previewOpen && form.screenshot_base64 && (
          <div
            className="m-screenshot-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="캡처 이미지 크게 보기"
            onClick={() => setPreviewOpen(false)}
          >
            <span className="m-screenshot-lightbox-close">ESC 또는 바깥 클릭으로 닫기</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.screenshot_base64}
              alt={screenshotName || '서비스 화면 캡처'}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        <div className="m-modal-field">
          <div className="m-modal-label">④ 포스팅 시놉 <span className="text-huma-t3">선택 — 없으면 Claude가 자율 작성</span></div>
          <textarea
            className="m-modal-input m-modal-textarea"
            placeholder={'예: 올해는 변화의 해. 두렵지 않아도 돼.\n(방향성·톤·핵심 메시지를 자유롭게 입력)'}
            value={form.synopsis}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
          />
        </div>

        <div className="rounded-md border border-huma-bdr bg-huma-bg3 px-3 py-2.5">
          <label className={`flex cursor-pointer items-start gap-2 ${!editable && 'opacity-60'}`}>
            <input
              type="checkbox"
              className="mt-0.5 shrink-0 accent-huma-acc"
              checked={form.auto_schedule}
              disabled={!editable}
              onChange={(e) => setForm((f) => ({ ...f, auto_schedule: e.target.checked }))}
            />
            <div>
              <div className="text-[13px] font-medium text-huma-t">플랫폼별 최적 시간 자동 배분</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-huma-t3">
                Haiku + <span className="text-huma-acc">optimal_schedule</span> — 플랫폼·요일·시간대별 조회 패턴 분석
              </div>
            </div>
          </label>
          {form.auto_schedule && (
            <div className="mt-2 flex flex-wrap gap-2 rounded bg-huma-bg2 px-2 py-1.5 font-mono text-[10.5px] text-huma-t3">
              <span>네이버 블로그 <span className="text-huma-ok">→ 오전 10:00</span></span>
              <span>Instagram <span className="text-huma-ok">→ 오후 7:30</span></span>
              <span>TikTok <span className="text-huma-ok">→ 오후 9:00</span></span>
              <span>X/Threads <span className="text-huma-ok">→ 오전 8:00</span></span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-md border border-huma-bdr2 bg-huma-bg3 px-3 py-2 font-mono text-[11px] text-huma-t3">
          <span>🎛</span>
          <span>
            이미지·영상 모델은{' '}
            <Link href="/video-pipeline" className="font-semibold text-huma-acc hover:underline" onClick={onClose}>
              영상 파이프라인 → 모델 설정
            </Link>
            에서 전역 설정 → 전체 작업에 자동 적용
          </span>
        </div>

        {!form.auto_schedule && (
          <div className="m-modal-field">
            <div className="m-modal-label">예약 시간</div>
            <input
              type="time"
              className="m-modal-input"
              value={form.schedule_time}
              disabled={!editable}
              onChange={(e) => setForm((f) => ({ ...f, schedule_time: e.target.value }))}
            />
          </div>
        )}

        {!isEdit && (
          <div className="m-modal-cost">
            <div className="text-[11.5px] font-mono text-huma-t3">예상 AI 비용 (건당)</div>
            <div className="text-[13.5px] font-semibold text-huma-t">
              약 104원 <span className="text-[10.5px] font-normal text-huma-t3">(Sonnet $0.069 + Haiku $0.0025)</span>
            </div>
          </div>
        )}

        {error && <p className="mb-2 text-xs text-huma-err">{error}</p>}

        <div className="m-modal-foot">
          {!isEdit && onPreview ? (
            <button
              type="button"
              className="btn-primary flex-[2] py-2"
              onClick={handlePreview}
              disabled={loading || !editable}
            >
              {loading ? '등록 중…' : '🔍 검증 미리보기 (새 창 · 네이버 미발행)'}
            </button>
          ) : (
            <button type="button" className="btn-primary flex-[2] py-2" onClick={handleSubmit} disabled={loading || !editable}>
              {loading ? (isEdit ? '저장 중…' : 'AI 생성 중…') : isEdit ? '저장' : '🚀 AI 생성 + 발행 큐 등록'}
            </button>
          )}
          {!isEdit && onPreview ? (
            <button
              type="button"
              className="btn-ghost flex-1 py-2 text-huma-warn"
              onClick={handleSubmit}
              disabled={loading || !editable}
              title="네이버 블로그에 실제 발행됩니다"
            >
              발행 큐
            </button>
          ) : null}
          <button type="button" className="btn-ghost flex-1 py-2" onClick={onClose} disabled={loading}>
            취소
          </button>
        </div>
        <p className="mt-2 text-center font-mono text-[10.5px] text-huma-t3">
          {!isEdit && onPreview
            ? '검증 모드: Claude·Imagen 확인 + 타이핑 시뮬만 · 계정 정지 전까지 네이버 발행은 「발행 큐」만 사용'
            : form.auto_schedule
              ? '등록 직후 AI 생성 시작 · 네이버·SNS 발행 시각만 Haiku가 결정합니다'
              : `생성·발행 시작: ${buildScheduledAt(form.schedule_time).slice(0, 16).replace('T', ' ')}`}
        </p>
      </div>
    </div>
  );
}
