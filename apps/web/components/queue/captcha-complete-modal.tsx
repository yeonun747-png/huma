'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';
import { copyVncEndpoint, isTailscaleEndpoint, parseVncEndpoint } from '@/lib/open-vnc';

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

  const runComplete = async (url?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await api.completeCaptchaJob(job.id, url);
      onCompleted();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const resumePublishing = () => void runComplete(undefined);

  const manualComplete = () => {
    const trimmed = resultUrl.trim();
    if (!trimmed) {
      setError('수동 완료는 발행 URL을 입력해 주세요.');
      return;
    }
    void runComplete(trimmed);
  };

  const ws = WS_LABEL[job.workspace ?? ''] ?? job.workspace ?? '—';
  const isCrank = job.job_type === 'social_crank';
  const expiresAt = holdInfo?.hold?.expiresAt;
  const vncEndpoint = holdInfo?.vnc_url ? parseVncEndpoint(holdInfo.vnc_url) : null;
  const vncViaTailscale = vncEndpoint ? isTailscaleEndpoint(vncEndpoint) : false;

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
        <div className="m-modal-t">
          {isCrank ? '캡cha — C-Rank 활동 재개' : '캡cha — 발행 재개'}
        </div>
        <p className="-mt-2 mb-4 text-sm text-huma-t2">
          {isCrank ? (
            <>
              VNC에서 캡cha·로그인을 마친 뒤 <strong>활동 재개</strong>를 누르세요. 블로그 방문·공감·댓글이
              자동으로 이어집니다.
            </>
          ) : (
            <>
              VNC에서 캡cha를 푼 뒤 <strong>자동으로 발행 재개</strong>됩니다(글쓰기 버튼 확인 시). 필요하면{' '}
              <strong>발행 재개</strong>를 눌러도 됩니다. 워밍업·naver.com 홈 없이 블로그 에디터로 바로
              이어집니다. VNC에서 직접 발행까지 끝냈다면 아래 URL을 넣고 <strong>수동 완료</strong>를
              누르세요.
            </>
          )}
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
              {vncViaTailscale ? (
                <>
                  <strong className="text-huma-t2">Tailscale</strong> — RealVNC Direct · PC에도 Tailscale(
                  goriccc@gmail.com) 로그인 필수 · 집 밖 OK
                </>
              ) : (
                <>
                  <strong className="text-huma-t2">LAN</strong> — RealVNC Direct · 같은 Wi‑Fi에서만 · 집 밖은 i7{' '}
                  <span className="font-mono">setup-tailscale.sh</span>
                </>
              )}
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

        {!isCrank ? (
          <label className="m-modal-field block text-sm text-huma-t2">
            <div className="m-modal-label">
              발행 URL <span className="text-huma-t4">(수동 완료 시 필수)</span>
            </div>
            <input
              type="url"
              className="m-modal-input"
              placeholder="https://blog.naver.com/..."
              value={resultUrl}
              onChange={(e) => setResultUrl(e.target.value)}
            />
          </label>
        ) : null}

        {error ? <p className="mt-2 text-sm text-huma-err">{error}</p> : null}

        <div className="m-modal-foot justify-end">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={submitting}>
            닫기
          </button>
          {!isCrank ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={manualComplete}
              disabled={submitting}
            >
              {submitting ? '처리 중…' : '수동 완료'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => (isCrank ? void runComplete(undefined) : resumePublishing())}
            disabled={submitting}
          >
            {submitting ? '처리 중…' : isCrank ? '활동 재개' : '발행 재개'}
          </button>
        </div>
      </div>
    </div>
  );
}
