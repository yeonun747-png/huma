/** Playwright 네이버 로그인 실패 → 운영자용 코드 */

export function isPlaywrightTimeout(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return /timeout/i.test(msg) || msg.includes('Timeout');
}

export function classifyNaverLoginPage(url: string, errText: string | null): string | null {
  const lower = url.toLowerCase();
  if (lower.includes('captcha') || lower.includes('challenge')) return 'CAPTCHA_DETECTED';
  if (lower.includes('device') || lower.includes('new_env') || lower.includes('otp')) {
    return 'NAVER_LOGIN_DEVICE_VERIFY';
  }
  if (!lower.includes('nidlogin.login')) return null;

  const text = (errText ?? '').trim();
  if (text) {
    if (/아이디|비밀번호|password|login/i.test(text)) return 'NAVER_LOGIN_CREDENTIALS';
    if (/2단계|인증번호|otp/i.test(text)) return 'NAVER_LOGIN_2FA';
    return `NAVER_LOGIN_FAILED:${text.slice(0, 120)}`;
  }
  return 'NAVER_LOGIN_FAILED:redirect_stuck';
}

export function wrapNaverLoginTimeout(step: string, err: unknown): Error {
  if (isPlaywrightTimeout(err)) {
    return new Error(`NAVER_LOGIN_TIMEOUT:${step}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
