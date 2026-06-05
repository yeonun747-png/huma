'use client';

import { useState } from 'react';
import type { JobType } from '@huma/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'post_blog', label: '블로그 발행' },
  { value: 'cafe_new_post', label: '카페 새글' },
  { value: 'cafe_reply', label: '카페 댓글' },
  { value: 'social_crank', label: 'C-Rank 소통' },
  { value: 'tiktok_upload', label: 'TikTok' },
  { value: 'instagram_reel', label: 'Instagram Reel' },
  { value: 'threads_post', label: 'Threads' },
  { value: 'threads_reply', label: 'Threads 댓글(링크)' },
  { value: 'twitter_post', label: 'Twitter/X' },
  { value: 'twitter_reply', label: 'X 댓글(링크)' },
];

export interface JobScheduleFormValues {
  title: string;
  job_type: JobType;
  scheduled_at: string;
  content?: string;
}

interface JobScheduleFormProps {
  workspace: string;
  defaultDate?: string;
  onSubmit: (values: JobScheduleFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

export function toLocalDatetimeValue(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function JobScheduleForm({
  workspace,
  defaultDate,
  onSubmit,
  onCancel,
  submitLabel = '예약 등록',
}: JobScheduleFormProps) {
  const [form, setForm] = useState<JobScheduleFormValues>({
    title: '',
    job_type: 'post_blog',
    scheduled_at: defaultDate ? toLocalDatetimeValue(defaultDate) : toLocalDatetimeValue(),
    content: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!form.title.trim()) return;
    setLoading(true);
    try {
      await onSubmit(form);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>작업 예약 · {workspace}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[10px] text-huma-t3">제목</label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="발행 제목"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-huma-t3">작업 유형</label>
            <select
              value={form.job_type}
              onChange={(e) => setForm((f) => ({ ...f, job_type: e.target.value as JobType }))}
              className="h-9 w-full rounded-md border border-huma-bdr bg-huma-bg3 px-2 text-xs text-huma-t"
            >
              {JOB_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-huma-t3">예약 시각</label>
          <Input
            type="datetime-local"
            value={form.scheduled_at}
            onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-huma-t3">본문 (선택)</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={3}
            className="w-full rounded-md border border-huma-bdr bg-huma-bg3 px-3 py-2 text-xs text-huma-t"
            placeholder="콘텐츠 본문"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={loading}>{submitLabel}</Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>취소</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function formatScheduledAt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 큐 카드용 — 오늘/내일/날짜 + 시각 */
export function formatScheduleLabel(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOf(d).getTime() - startOf(now).getTime()) / 86_400_000);
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (diffDays === 0) return `오늘 ${time}`;
  if (diffDays === 1) return `내일 ${time}`;
  if (diffDays === -1) return `어제 ${time}`;
  return d.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function isSchedulePast(iso?: string): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

/** 미래: 「오늘 22:30 시작 예정」 / 과거: 「어제 22:30 예정 시각」 */
export function formatScheduleStartDesc(iso?: string): string {
  if (!iso) return '—';
  const when = formatScheduleLabel(iso);
  return isSchedulePast(iso) ? `${when} 예정 시각` : `${when} 시작 예정`;
}

/** 큐 태그 — 지난 예약·미실행이면 「지연」 */
export function formatScheduleQueueTag(iso: string | undefined, status: string): string {
  if (!iso) return status;
  const when = formatScheduleLabel(iso);
  if (isSchedulePast(iso) && (status === 'scheduled' || status === 'pending')) {
    return `${when} · 지연`;
  }
  if (status === 'failed') return `${when} · 실패`;
  return when;
}

