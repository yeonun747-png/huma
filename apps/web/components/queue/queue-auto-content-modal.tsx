'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import type { Workspace } from '@huma/shared';
import { buildScheduledAt } from '@/lib/queue-repeat';
import type { QueuePrefill } from '@/lib/queue-prefill';
import { extractKstScheduleTime } from '@/lib/format-kst';
import { formatScheduleLabel } from './job-schedule-form';
import { api } from '@/lib/api';
import { compressImageFileForUpload } from '@/lib/compress-image-for-upload';
import {
  groupPostingAccountsByDongle,
  type PostingAccountOption,
  type PostingDongleAccountGroup,
} from '@/lib/posting-dongle-groups';

const IMAGE_SLOT_COUNT = 5;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export type UploadedImageSlot = string | undefined;

export interface AutoContentFormValues {
  title: string;
  source_url: string;
  synopsis: string;
  auto_schedule: boolean;
  uploaded_images: UploadedImageSlot[];
  schedule_time: string;
  /** 수동 등록 — 포스팅 계정 (전 workspace 필수) */
  account_id: string;
}

export type AutoContentSubmitContext = {
  onUploadProgress?: (done: number, total: number) => void;
};

interface QueueAutoContentModalProps {
  workspace: Workspace;
  open: boolean;
  editJob?: HumaJob | null;
  prefill?: QueuePrefill | null;
  onClose: () => void;
  onSubmit: (values: AutoContentFormValues, ctx?: AutoContentSubmitContext) => Promise<void>;
  onPreview?: (values: AutoContentFormValues, ctx?: AutoContentSubmitContext) => Promise<void>;
}

const EMPTY_SLOTS: UploadedImageSlot[] = Array.from({ length: IMAGE_SLOT_COUNT });

const EMPTY_FORM: AutoContentFormValues = {
  title: '',
  source_url: '',
  synopsis: '',
  auto_schedule: true,
  uploaded_images: [...EMPTY_SLOTS],
  schedule_time: '10:00',
  account_id: '',
};

function slotsFromJob(job: HumaJob): UploadedImageSlot[] {
  const slots: UploadedImageSlot[] = [...EMPTY_SLOTS];
  (job.image_urls ?? []).slice(0, IMAGE_SLOT_COUNT).forEach((url, i) => {
    slots[i] = url;
  });
  return slots;
}

function jobToForm(job: HumaJob): AutoContentFormValues {
  return {
    title: job.title ?? '',
    source_url: job.link_url ?? '',
    synopsis: job.content ?? '',
    auto_schedule: job.auto_scheduled ?? true,
    uploaded_images: slotsFromJob(job),
    schedule_time: extractKstScheduleTime(job.scheduled_at),
    account_id: job.account_id ?? '',
  };
}

function countFilledSlots(slots: UploadedImageSlot[]): number {
  return slots.filter(Boolean).length;
}

export function QueueAutoContentModal({
  workspace,
  open,
  editJob,
  prefill,
  onClose,
  onSubmit,
  onPreview,
}: QueueAutoContentModalProps) {
  const fileRefs = useRef<Array<HTMLInputElement | null>>([]);
  const isEdit = Boolean(editJob);
  const editable = !editJob || ['pending', 'scheduled', 'paused'].includes(editJob.status);

  const [form, setForm] = useState<AutoContentFormValues>(EMPTY_FORM);
  const [slotNames, setSlotNames] = useState<string[]>(Array(IMAGE_SLOT_COUNT).fill(''));
  const [previewSlot, setPreviewSlot] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [loadingAction, setLoadingAction] = useState<'preview' | 'publish' | null>(null);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [postingAccountGroups, setPostingAccountGroups] = useState<PostingDongleAccountGroup[]>([]);
  const [postingAccountOptions, setPostingAccountOptions] = useState<PostingAccountOption[]>([]);
  const [accountsSyncing, setAccountsSyncing] = useState(false);

  const loading = loadingAction !== null;
  const uploadPct =
    uploadProgress.total > 0 ? Math.round((uploadProgress.done / uploadProgress.total) * 100) : 0;

  useEffect(() => {
    if (!open) return;
    if (editJob) {
      setForm(jobToForm(editJob));
      setSlotNames(
        slotsFromJob(editJob).map((url, i) => (url ? `슬롯 ${i + 1}` : '')),
      );
    } else if (prefill) {
      setForm({
        ...EMPTY_FORM,
        title: prefill.title,
        source_url: prefill.source_url,
        account_id: '',
      });
      setSlotNames(Array(IMAGE_SLOT_COUNT).fill(''));
    } else {
      setForm({ ...EMPTY_FORM });
      setSlotNames(Array(IMAGE_SLOT_COUNT).fill(''));
    }
    setPreviewSlot(null);
    setDragOverSlot(null);
    setError('');
    setLoadingAction(null);
    setUploadProgress({ done: 0, total: 0 });
  }, [open, editJob, prefill, workspace]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAccountsSyncing(true);

    void api
      .getPostingAccounts(workspace)
      .then((res) => {
        if (cancelled) return;
        const options: PostingAccountOption[] = (res.accounts ?? []).map((a) => ({
          id: a.id,
          label: a.label ?? a.id,
          proxy_port: a.proxy_port,
        }));
        const groups = groupPostingAccountsByDongle(workspace, options);
        setPostingAccountGroups(groups);
        setPostingAccountOptions(options);
        if (!editJob) {
          setForm((f) => ({
            ...f,
            account_id: f.account_id || options[0]?.id || '',
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPostingAccountGroups([]);
          setPostingAccountOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setAccountsSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, workspace, editJob]);

  const requirePostingAccount = !isEdit;

  const validateForm = (): boolean => {
    if (requirePostingAccount) {
      if (accountsSyncing) {
        setError('포스팅 계정 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.');
        return false;
      }
      if (!form.account_id.trim()) {
        setError('포스팅 계정을 선택하세요.');
        return false;
      }
      if (!postingAccountOptions.some((a) => a.id === form.account_id)) {
        setError('유효한 포스팅 계정을 선택하세요.');
        return false;
      }
    }
    return true;
  };

  useEffect(() => {
    if (previewSlot == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewSlot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewSlot]);

  useEffect(() => {
    const clearDrag = () => setDragOverSlot(null);
    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag);
    return () => {
      window.removeEventListener('dragend', clearDrag);
      window.removeEventListener('drop', clearDrag);
    };
  }, []);

  if (!open) return null;

  const filledCount = countFilledSlots(form.uploaded_images);

  const setSlotImage = (index: number, data: string | undefined, name = '') => {
    setForm((f) => {
      const uploaded_images = [...f.uploaded_images];
      uploaded_images[index] = data;
      return { ...f, uploaded_images };
    });
    setSlotNames((names) => {
      const next = [...names];
      next[index] = name;
      return next;
    });
  };

  const handleFile = async (index: number, file?: File | null) => {
    if (!file || !editable) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError('PNG · JPG · WEBP 이미지만 등록할 수 있습니다.');
      return;
    }
    setError('');
    try {
      const data = await compressImageFileForUpload(file);
      setSlotImage(index, data, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 등록 실패');
    }
  };

  const clearSlot = (index: number) => {
    setSlotImage(index, undefined, '');
    const input = fileRefs.current[index];
    if (input) input.value = '';
  };

  const reportUploadProgress = (done: number, total: number) => {
    setUploadProgress({ done, total });
  };

  const handlePreview = async () => {
    if (isEdit && (!form.title.trim() || !form.source_url.trim())) {
      setError('수정 시 제목과 URL은 필수입니다.');
      return;
    }
    if (!validateForm()) return;
    if (!onPreview || isEdit) return;
    setError('');
    setLoadingAction('preview');
    setUploadProgress({ done: 0, total: 0 });
    try {
      await onPreview(form, { onUploadProgress: reportUploadProgress });
      setForm(EMPTY_FORM);
      setSlotNames(Array(IMAGE_SLOT_COUNT).fill(''));
      setPreviewSlot(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '검증 등록 실패');
    } finally {
      setLoadingAction(null);
      setUploadProgress({ done: 0, total: 0 });
    }
  };

  const handleSubmit = async () => {
    if (isEdit && (!form.title.trim() || !form.source_url.trim())) {
      setError('수정 시 제목과 URL은 필수입니다.');
      return;
    }
    if (!validateForm()) return;
    setError('');
    setLoadingAction('publish');
    setUploadProgress({ done: 0, total: 0 });
    try {
      await onSubmit(form, { onUploadProgress: reportUploadProgress });
      if (!isEdit) {
        setForm(EMPTY_FORM);
        setSlotNames(Array(IMAGE_SLOT_COUNT).fill(''));
        setPreviewSlot(null);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : isEdit ? '저장 실패' : '등록 실패');
    } finally {
      setLoadingAction(null);
      setUploadProgress({ done: 0, total: 0 });
    }
  };

  return (
    <div
      className="m-modal-bg open"
      role="presentation"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="m-modal m-modal-queue" role="dialog" aria-modal="true">
        <div className="m-modal-t flex items-start justify-between gap-2">
          <span>{isEdit ? '📝 포스팅 작업 수정' : '📝 포스팅 작업 추가'}</span>
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0 px-2"
            onClick={onClose}
            disabled={loading}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

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
            <div className="m-ai-engine-sub">블로그 글·해시태그·Imagen 프롬프트</div>
          </div>
          <div className="m-ai-engine sub">
            <div className="m-ai-engine-tag">SUB</div>
            <div className="m-ai-engine-name">Claude Haiku 4.5</div>
            <div className="m-ai-engine-sub">발행 시간·Imagen 모델 자동판단</div>
          </div>
        </div>

        <div className="m-modal-field">
          <div className="m-modal-label">
            포스팅 계정 <span className="text-huma-err">필수</span>
          </div>
          {accountsSyncing ? (
            <p className="font-mono text-[10.5px] text-huma-t3">계정 목록 불러오는 중…</p>
          ) : postingAccountOptions.length ? (
            <div className="flex flex-col gap-2">
              {postingAccountGroups.map((group) =>
                group.accounts.length ? (
                  <div key={group.proxy_port}>
                    <div className="mb-1 font-mono text-[10px] text-huma-t3">
                      {group.dongle_label} · :{group.proxy_port}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.accounts.map((ac) => {
                        const selected = form.account_id === ac.id;
                        return (
                          <label
                            key={ac.id}
                            className={`cursor-pointer rounded-md border px-3 py-2 font-mono text-[11px] ${
                              selected
                                ? 'border-huma-acc bg-huma-acc/10 text-huma-acc'
                                : 'border-huma-bdr text-huma-t2 hover:border-huma-bdr2'
                            } ${!editable ? 'pointer-events-none opacity-60' : ''}`}
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              name="posting-account"
                              checked={selected}
                              disabled={!editable}
                              onChange={() => setForm((f) => ({ ...f, account_id: ac.id }))}
                            />
                            {ac.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <p className="font-mono text-[10.5px] text-huma-t3">포스팅 계정 없음 — 계정관리에서 등록하세요</p>
          )}
        </div>

        <div className="m-modal-field">
          <div className="m-modal-label">
            ① 포스팅 제목 <span className="text-huma-t3">선택 — 비우면 캐시에서 자동</span>
          </div>
          <input
            className="m-modal-input"
            placeholder="비우면 연운 상품·퀴즈·캐릭터 캐시에서 자동 선택"
            value={form.title}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className="m-modal-field">
          <div className="m-modal-label">
            ② 관련 URL <span className="text-huma-t3">선택 — 비우면 자동 생성</span>
          </div>
          <input
            className="m-modal-input"
            placeholder="예: myquizoasis.com/ko/test/… · panana.kr/c/… · yeonun.com/fortune/…"
            value={form.source_url}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, source_url: e.target.value }))}
          />
        </div>

        {!form.title.trim() && !form.source_url.trim() ? (
          <p className="-mt-1 mb-2 font-mono text-[10.5px] text-huma-acc">
            제목·URL 모두 비우면 「포스팅 큐」만 눌러도 계정관리 캐시 기준으로 완전 자동 발행됩니다.
          </p>
        ) : null}

        <div className="m-modal-field">
          <div className="m-modal-label">
            ③ 포스팅 이미지 <span className="text-huma-t3">선택 · 0장이면 Imagen 4 생성</span>
          </div>
          <p className="mb-2 font-mono text-[10.5px] text-huma-t3">
            PNG · WEBP · JPG · 최대 5장 · 등록 {filledCount}장
            {filledCount > 0 ? ' — Imagen 생략' : ''}
          </p>
          <div
            className="m-image-slots-grid"
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDragOverSlot(null);
              }
            }}
          >
            {form.uploaded_images.map((src, index) => (
              <div
                key={index}
                className={`m-image-slot-wrap${dragOverSlot === index ? ' is-drag-over' : ''}`}
                onDragEnter={(e) => {
                  if (!editable) return;
                  e.preventDefault();
                  setDragOverSlot(index);
                }}
                onDragOver={(e) => {
                  if (!editable) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  setDragOverSlot(index);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDragOverSlot((prev) => (prev === index ? null : prev));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverSlot(null);
                  void handleFile(index, e.dataTransfer.files[0]);
                }}
              >
                {index === 0 ? (
                  <span className="m-image-slot-badge">대표이미지</span>
                ) : null}
                <button
                  type="button"
                  className="m-modal-drop m-modal-drop-screenshot m-image-slot"
                  disabled={!editable}
                  onClick={() => fileRefs.current[index]?.click()}
                >
                  {src ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={slotNames[index] || `이미지 슬롯 ${index + 1}`}
                        className="m-modal-drop-screenshot-img"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewSlot(index);
                        }}
                      />
                      <span className="m-modal-drop-screenshot-hint">클릭 확대 · 드래그 교체</span>
                      {editable ? (
                        <span
                          role="button"
                          tabIndex={0}
                          className="m-image-slot-clear"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearSlot(index);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              clearSlot(index);
                            }
                          }}
                        >
                          ✕
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-mono text-huma-t3">{index + 1}</div>
                      <div className="text-[10px] text-huma-t3">드래그 또는 클릭</div>
                    </>
                  )}
                </button>
                <input
                  ref={(el) => {
                    fileRefs.current[index] = el;
                  }}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => void handleFile(index, e.target.files?.[0])}
                />
              </div>
            ))}
          </div>
        </div>

        {previewSlot != null && form.uploaded_images[previewSlot] && (
          <div
            className="m-screenshot-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="등록 이미지 크게 보기"
            onClick={() => setPreviewSlot(null)}
          >
            <span className="m-screenshot-lightbox-close">ESC 또는 바깥 클릭으로 닫기</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.uploaded_images[previewSlot]!}
              alt={slotNames[previewSlot] || `이미지 슬롯 ${previewSlot + 1}`}
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
              <div className="text-[13px] font-medium text-huma-t">네이버 발행 시간 자동 배분</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-huma-t3">
                활성 시간대에 오늘 목표 건수 기준 <span className="text-huma-acc">대략 균등 슬롯</span> 배분 ·
                동글 계정 간 10분 간격
              </div>
            </div>
          </label>
          {form.auto_schedule && (
            <div className="mt-2 rounded bg-huma-bg2 px-2 py-1.5 font-mono text-[10.5px] text-huma-t3">
              콘텐츠 생성은 즉시 · 네이버 발행 시각은 계정별 슬롯 플래너가 자동 배정
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-md border border-huma-bdr2 bg-huma-bg3 px-3 py-2 font-mono text-[11px] text-huma-t3">
          <span>🖼</span>
          <span>
            Imagen 이미지 모델은 이 페이지 상단{' '}
            <span className="font-semibold text-huma-acc">포스팅 이미지 설정</span>
            에서 변경 · 숏폼 영상은{' '}
            <Link href="/video-content" className="font-semibold text-huma-acc hover:underline" onClick={onClose}>
              숏폼 영상 관리
            </Link>
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

        {error && <p className="mb-2 text-xs text-huma-err">{error}</p>}

        <div className={`m-modal-foot ${!isEdit && onPreview ? 'grid grid-cols-2 gap-2' : ''}`}>
          {!isEdit && onPreview ? (
            <button
              type="button"
              className="btn-ghost min-w-0 py-2 text-[11px] leading-tight sm:text-xs"
              onClick={handlePreview}
              disabled={loading || !editable}
            >
              {loadingAction === 'preview' ? '등록 중…' : '🔍 검증 미리보기 데모'}
            </button>
          ) : (
            <button type="button" className="btn-primary flex-[2] py-2" onClick={handleSubmit} disabled={loading || !editable}>
              {loadingAction === 'publish'
                ? uploadPct > 0 && uploadPct < 100
                  ? `등록 중… ${uploadPct}%`
                  : '등록 중…'
                : isEdit
                  ? '저장'
                  : '🚀 생성 + 포스팅 큐 등록'}
            </button>
          )}
          {!isEdit && onPreview ? (
            <button
              type="button"
              className="btn-primary btn-upload-progress min-w-0 py-2 text-[11px] leading-tight sm:text-xs"
              onClick={handleSubmit}
              disabled={loading || !editable}
              title="Claude·Imagen 새로 생성 후 네이버 발행"
              data-progress={loadingAction === 'publish' ? uploadPct : 0}
            >
              <span
                className="btn-upload-progress-fill"
                style={{ width: loadingAction === 'publish' ? `${Math.max(uploadPct, 8)}%` : '0%' }}
                aria-hidden
              />
              <span className="btn-upload-progress-label">
                {loadingAction === 'publish'
                  ? uploadPct > 0 && uploadPct < 100
                    ? `등록 중… ${uploadPct}%`
                    : '등록 중…'
                  : '포스팅 큐'}
              </span>
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-center font-mono text-[10.5px] text-huma-t3">
          {form.auto_schedule
            ? '등록 직후 Claude·Imagen 생성 · 네이버 발행은 활성 시간대 슬롯에 자동 배정'
            : `생성·발행 시작: ${buildScheduledAt(form.schedule_time).slice(0, 16).replace('T', ' ')}`}
        </p>
      </div>
    </div>
  );
}

function compactUploadedImages(slots: UploadedImageSlot[]): string[] | undefined {
  const out = slots.filter((s): s is string => Boolean(s?.trim()));
  return out.length ? out : undefined;
}

export { compactUploadedImages };
