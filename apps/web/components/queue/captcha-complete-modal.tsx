'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';
import { copyVncEndpoint, parseVncEndpoint } from '@/lib/open-vnc';

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
  const [vncCopied, setVncCopied] = useState(false);

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
  const vncEndpoint = holdInfo?.vnc_url ? parseVncEndpoint(holdInfo.vnc_url) : null;

  const copyEndpoint = async () => {
    if (!vncEndpoint) return;
    const ok = await copyVncEndpoint(vncEndpoint);
    if (ok) {
      setVncCopied(true);
      window.setTimeout(() => setVncCopied(false), 2500);
    }
  };

  return (
    <div className="m-modal-bg open z-[200] p-4" role="dialog" aria-modal="true">
      <div className="m-modal w-full max-w-md">
        <div className="m-modal-t">캡cha — 수동 발행 완료</div>
        <p className="-mt-2 mb-4 text-sm text-huma-t2">
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

        {holdInfo?.vnc_url && vncEndpoint ? (
          <div className="mt-3 rounded-md border border-huma-bdr2 bg-huma-bg3 px-3 py-2.5 text-sm">
            <p className="text-xs text-huma-t3">
              <strong className="text-huma-t2">권장</strong> RealVNC Viewer → Direct → 아래 주소 (같은 Wi‑Fi/LAN)
            </p>
            <p className="mt-1.5 font-mono text-base text-huma-t1">{vncEndpoint}</p>
            <div className="mt-2">
              <button type="button" className="btn-primary btn-sm" onClick={() => void copyEndpoint()}>
                {vncCopied ? '복사됨 ✓' : '주소 복사 → Direct'}
              </button>
            </div>
          </div>
        ) : holdInfo?.vnc_url ? (
          <p className="mt-3 text-xs text-huma-t3">RealVNC Direct — {holdInfo.vnc_url}</p>
        ) : (
          <p className="mt-3 text-xs text-huma-t3">VNC URL — 서버 env HUMA_VNC_URL_* 설정</p>
        )}

        <label className="m-modal-field block text-sm text-huma-t2">
          <div className="m-modal-label">발행 URL <span className="text-huma-t4">(선택)</span></div>
          <input
            type="url"
            className="m-modal-input"
            placeholder="https://blog.naver.com/..."
            value={resultUrl}
            onChange={(e) => setResultUrl(e.target.value)}
          />
        </label>

        {error ? <p className="mt-2 text-sm text-huma-err">{error}</p> : null}

        <div className="m-modal-foot justify-end">
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
