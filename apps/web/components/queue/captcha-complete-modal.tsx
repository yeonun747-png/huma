'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HumaJob } from '@huma/shared';
import { api } from '@/lib/api';
import { WS_LABEL } from '@/lib/constants';
import { copyVncEndpoint, isTailscaleEndpoint, parseVncEndpoint } from '@/lib/open-vnc';

interface CaptchaHoldInfo {
  job_status: string;
  hold: {
    active: boolean;
    expiresAt?: string;
    captchaScreenshotUpdatedAt?: number;
    hasCaptchaScreenshot?: boolean;
    captchaRound?: number;
  } | null;
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
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [sendingAnswer, setSendingAnswer] = useState(false);
  const [answerMsg, setAnswerMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotLightbox, setScreenshotLightbox] = useState(false);
  const [screenshotUpdatedAt, setScreenshotUpdatedAt] = useState<number | undefined>();

  const loadScreenshot = useCallback(async (updatedAt?: number) => {
    const url = await api.fetchCaptchaScreenshotObjectUrl(job.id, updatedAt);
    setScreenshotUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, [job.id]);

  const loadHold = useCallback(async () => {
    try {
      const info = await api.getCaptchaHold(job.id);
      setHoldInfo(info);
      if (info.hold?.hasCaptchaScreenshot) {
        const at = info.hold.captchaScreenshotUpdatedAt;
        if (at !== screenshotUpdatedAt) {
          setScreenshotUpdatedAt(at);
          await loadScreenshot(at);
        }
      }
    } catch {
      setHoldInfo(null);
    }
  }, [job.id, loadScreenshot, screenshotUpdatedAt]);

  useEffect(() => {
    void loadHold();
    const timer = window.setInterval(() => void loadHold(), 4000);
    return () => window.clearInterval(timer);
  }, [loadHold]);

  useEffect(() => {
    return () => {
      if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    };
  }, [screenshotUrl]);

  const runComplete = async (url?: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await api.completeCaptchaJob(job.id, url);
      onCompleted();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('CAPTCHA_RESUME_IN_PROGRESS')) {
        onCompleted();
        onClose();
        return;
      }
      if (msg.includes('CAPTCHA_STILL_VISIBLE')) {
        setError('CAPTCHA가 아직 화면에 있습니다. VNC에서 정답을 다시 확인하거나 정답 제출을 눌러 주세요.');
        return;
      }
      if (msg.includes('CAPTCHA_PENDING_LOGIN')) {
        setError('CAPTCHA는 통과됐습니다. VNC에서 로그인 버튼을 누른 뒤 발행 재개를 다시 눌러 주세요.');
        return;
      }
      if (msg.includes('CAPTCHA_LOGIN_NOT_READY')) {
        setError(
          '네이버 로그인이 확인되지 않습니다. VNC에서 로그인을 완료한 뒤(www.naver.com MY 영역) 발행 재개를 눌러 주세요.',
        );
        return;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const resumePublishing = () => void runComplete(undefined);

  const sendCaptchaAnswer = async () => {
    const trimmed = captchaAnswer.trim();
    if (!trimmed) {
      setAnswerMsg({ ok: false, text: '정답을 입력해 주세요.' });
      return;
    }
    setSendingAnswer(true);
    setAnswerMsg(null);
    try {
      const r = await api.submitCaptchaAnswer(job.id, trimmed);
      if (r.auto_resumed) {
        setAnswerMsg({
          ok: true,
          text: 'CAPTCHA 통과 — 발행이 자동으로 재개되었습니다. 모니터에서 확인하세요.',
        });
        setCaptchaAnswer('');
        onCompleted();
        window.setTimeout(() => onClose(), 1500);
      } else if (r.captcha_cleared && r.pending_login) {
        setAnswerMsg({
          ok: true,
          text: 'CAPTCHA 통과 — VNC에서 로그인 버튼을 눌러 주세요. 로그인 후 자동으로 블로그 에디터로 이어집니다.',
        });
        setCaptchaAnswer('');
        onCompleted();
      } else if (r.captcha_cleared) {
        setAnswerMsg({
          ok: true,
          text: 'CAPTCHA 통과 — 발행이 자동으로 진행됩니다. 모니터에서 확인하세요.',
        });
        setCaptchaAnswer('');
        onCompleted();
        window.setTimeout(() => onClose(), 1800);
      } else if (r.captcha_still_visible) {
        setAnswerMsg({
          ok: false,
          text: '제출했으나 CAPTCHA가 다시 나타났습니다(2중 캡차·오답). 아래 캡처를 확인하고 재입력하세요.',
        });
        if (r.hold?.hasCaptchaScreenshot) {
          await loadScreenshot(r.hold.captchaScreenshotUpdatedAt);
        }
      } else {
        setAnswerMsg({
          ok: false,
          text: '제출했으나 CAPTCHA가 남아 있습니다. VNC에서 이미지를 다시 확인하고 재입력하세요.',
        });
      }
    } catch (e) {
      setAnswerMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSendingAnswer(false);
    }
  };

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
          <div className="m-modal-field rounded-md border border-huma-bdr2 bg-huma-bg3 px-3 py-2.5">
            <div className="m-modal-label text-huma-t2">
              CAPTCHA 정답 원격 입력 <span className="text-huma-t4">(VNC 한글 입력 불필요)</span>
              {holdInfo?.hold?.captchaRound && holdInfo.hold.captchaRound > 1 ? (
                <span className="ml-2 text-huma-warn">· {holdInfo.hold.captchaRound}차 CAPTCHA</span>
              ) : null}
            </div>
            <p className="mb-2 text-xs text-huma-t3">
              VNC 화면의 CAPTCHA 이미지를 보고 정답(한글·숫자)을 여기에 입력하면 서버가 직접 입력칸에
              넣고 제출합니다. 통과되면 로그인 버튼만 VNC에서 누르면 자동으로 에디터까지 이어집니다.
            </p>
            {screenshotUrl ? (
              <button
                type="button"
                className="mb-3 block w-full overflow-hidden rounded-md border border-huma-bdr2 bg-black/5"
                onClick={() => setScreenshotLightbox(true)}
                title="클릭하면 크게 보기"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotUrl}
                  alt="CAPTCHA 캡처"
                  className="mx-auto max-h-40 w-full cursor-zoom-in object-contain"
                />
                <span className="block py-1 text-center text-[11px] text-huma-t4">클릭하면 크게 보기</span>
              </button>
            ) : null}
            <div className="flex gap-2">
              <input
                type="text"
                className="m-modal-input flex-1"
                placeholder="예: 솔뫼로 / 100"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void sendCaptchaAnswer();
                  }
                }}
                disabled={sendingAnswer}
              />
              <button
                type="button"
                className="btn-primary btn-sm shrink-0"
                onClick={() => void sendCaptchaAnswer()}
                disabled={sendingAnswer}
              >
                {sendingAnswer ? '제출 중…' : '정답 제출'}
              </button>
            </div>
            {answerMsg ? (
              <p className={`mt-2 text-xs ${answerMsg.ok ? 'text-huma-ok' : 'text-huma-err'}`}>
                {answerMsg.text}
              </p>
            ) : null}
          </div>
        ) : null}

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

      {screenshotLightbox && screenshotUrl ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setScreenshotLightbox(false)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded bg-black/50 px-3 py-1 text-sm text-white"
            onClick={() => setScreenshotLightbox(false)}
          >
            닫기
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotUrl}
            alt="CAPTCHA 확대"
            className="max-h-[90vh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
