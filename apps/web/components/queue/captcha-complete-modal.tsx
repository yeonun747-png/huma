'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';

interface CaptchaHoldInfo {
  job_status: string;
  hold: { active: boolean; expiresAt?: string } | null;
  vnc_url?: string | null;
  web_url?: string | null;
}

export function CaptchaCompleteModal({
  job,
  onClose,
  onCompleted,
}: {
  job: HumaJob;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [resultUrl, setResultUrl] = useState('');
  const [holdInfo, setHoldInfo] = useState<CaptchaHoldInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHold = useCallback(async () => {
    try {
      const info = await api.getCaptchaHold(job.id);
      setHoldInfo(info);
    } catch {
      setHoldInfo(null);
    }
  }, [job.id]);

  useEffect(() => {
    void loadHold();
  }, [loadHold]);

  const submitComplete = async () => {
    const trimmed = resultUrl.trim();
    if (!trimmed) {
      const ok = window.confirm(
        '발행 URL 없이 완료 처리할까요?\n\nVNC에서 발행까지 끝냈다면 OK를 누르세요. 나중에 URL은 기록에 남지 않습니다.',
      );
      if (!ok) return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.completeCaptchaJob(job.id, trimmed || undefined);
      onCompleted();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const ws = WS_LABEL[job.workspace ?? ''] ?? job.workspace ?? '—';
  const expiresAt = holdInfo?.hold?.expiresAt;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" role="dialog">
      <div className="w-full max-w-md rounded-lg border border-huma-bdr2 bg-huma-bg1 p-5 shadow-xl">
        <h2 className="text-base font-semibold text-huma-t1">캡cha — 수동 발행 완료</h2>
        <p className="mt-2 text-sm text-huma-t2">
          VNC에서 캡cha를 풀고 <strong>발행</strong>까지 한 뒤, 아래에서 huma 작업을 완료하세요.
        </p>

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-huma-t3 shrink-0">작업</dt>
            <dd className="text-huma-t1">{job.title ?? job.job_type}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-huma-t3 shrink-0">워크스페이스</dt>
            <dd className="text-huma-t1">{ws}</dd>
          </div>
          {expiresAt ? (
            <div className="flex gap-2">
              <dt className="text-huma-t3 shrink-0">세션 만료</dt>
              <dd className="text-huma-warn font-mono text-xs">{expiresAt}</dd>
            </div>
          ) : null}
        </dl>

        {holdInfo?.vnc_url ? (
          <a
            href={holdInfo.vnc_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm text-huma-accent underline"
          >
            VNC 열기
          </a>
        ) : (
          <p className="mt-3 text-xs text-huma-t3">VNC URL — 서버 env HUMA_VNC_URL_* 설정</p>
        )}

        <label className="mt-4 block text-sm text-huma-t2">
          발행 URL <span className="text-huma-t4">(선택)</span>
          <input
            type="url"
            className="mt-1 w-full rounded border border-huma-bdr2 bg-huma-bg2 px-3 py-2 text-sm text-huma-t1"
            placeholder="https://blog.naver.com/..."
            value={resultUrl}
            onChange={(e) => setResultUrl(e.target.value)}
          />
        </label>

        {error ? <p className="mt-2 text-sm text-huma-err">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={submitting}>
            닫기
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void submitComplete()} disabled={submitting}>
            {submitting ? '처리 중…' : '발행 완료'}
          </button>
        </div>
      </div>
    </div>
  );
}
