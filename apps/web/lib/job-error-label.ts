/** huma_jobs.error_message → 운영자용 한 줄 설명 */

function dedupeErrorMessage(message: string): string {
  const seen = new Set<string>();
  return message
    .trim()
    .split(/\s+/)
    .filter((token) => {
      if (!/(?:WARMUP_)?NO_LINKS_FOUND/.test(token)) return true;
      if (seen.has('NO_LINKS_FOUND')) return false;
      seen.add('NO_LINKS_FOUND');
      return true;
    })
    .join(' ');
}

function formatLinksNotFoundError(raw: string): string | null {
  if (!/(?:WARMUP_)?NO_LINKS_FOUND/.test(raw)) return null;

  const isWarmup = raw.includes('WARMUP_NO_LINKS_FOUND') || raw.includes(':warmup:');
  const ctx = /블로그/.test(raw) ? '블로그 검색' : '통합 검색';
  const phase = isWarmup ? '워밍업' : 'C-Rank 세션';

  return `${phase} 실패(${ctx}): 네이버 검색 결과에서 방문할 링크를 찾지 못했습니다. SOCKS 프록시·로그인·네이버 UI 변경을 확인하세요.`;
}

export function formatJobErrorLabel(message: string | null | undefined): string {
  if (!message?.trim()) return '';
  const raw = dedupeErrorMessage(message);

  const linksErr = formatLinksNotFoundError(raw);
  if (linksErr) return linksErr;

  if (raw.includes('CAPTCHA_DETECTED') || (raw.includes('CAPTCHA') && !raw.includes('LAYER4'))) {
    return '네이버 로그인 실패: 캡차(보안문자) 감지';
  }
  if (raw.includes('NAVER_LOGIN_TIMEOUT:page_load')) {
    return '네이버 로그인 실패: 로그인 페이지 로드 타임아웃';
  }
  if (raw.includes('NAVER_LOGIN_TIMEOUT:login_form')) {
    return '네이버 로그인 실패: 로그인 폼 대기 타임아웃';
  }
  if (raw.includes('NAVER_LOGIN_TIMEOUT:redirect')) {
    return '네이버 로그인 실패: 로그인 후 리다이렉트 타임아웃';
  }
  if (raw.includes('NAVER_LOGIN_TIMEOUT:shadow_walk')) {
    return '네이버 로그인 실패: 사전 탐색(shadow walk) 타임아웃';
  }
  if (raw.includes('NAVER_LOGIN_TIMEOUT')) {
    return '네이버 로그인 실패: 타임아웃';
  }
  if (raw.includes('NAVER_LOGIN_CREDENTIALS')) {
    return '네이버 로그인 실패: 아이디 또는 비밀번호 오류';
  }
  if (raw.includes('NAVER_LOGIN_2FA')) {
    return '네이버 로그인 실패: 2단계 인증 필요';
  }
  if (raw.includes('NAVER_LOGIN_DEVICE_VERIFY')) {
    return '네이버 로그인 실패: 새 기기·환경 인증 필요';
  }
  if (raw.startsWith('NAVER_LOGIN_FAILED:redirect_stuck')) {
    return '네이버 로그인 실패: 로그인 페이지에 머무름(캡차·인증·비밀번호 확인)';
  }
  if (raw.startsWith('NAVER_LOGIN_FAILED:')) {
    const detail = raw.slice('NAVER_LOGIN_FAILED:'.length).trim();
    return detail ? `네이버 로그인 실패: ${detail}` : '네이버 로그인 실패';
  }
  if (/timeout.*exceeded/i.test(raw) && /nidlogin|login|#id|waitForURL/i.test(raw)) {
    return '네이버 로그인 실패: 타임아웃';
  }

  if (raw.includes('NO_IDLE_MODEM')) {
    return 'C-Rank 동글 대기 — 슬롯 6·7이 사용 중이어서 15분 후 자동 재예약됩니다';
  }
  if (raw.includes('NO_MODEM')) {
    return '가용 C-Rank 동글(SOCKS) 없음 — 프록시 관리에서 슬롯 6·7 상태 확인';
  }
  if (raw.includes('LAYER4_REST')) {
    return 'Layer4 휴식 중인 계정 — Watcher에서 해제 후 재시도';
  }

  return raw;
}
