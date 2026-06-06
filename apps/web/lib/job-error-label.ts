/** huma_jobs.error_message → 운영자용 한 줄 설명 */

const WARMUP_REASON_LABEL: Record<string, string> = {
  connection: '접속 실패',
  block_captcha: '차단·캡차',
  dom_mismatch: 'DOM 불일치',
  filter_zero: '링크 필터로 0개',
};

function decodeField(value: string | undefined): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePipeFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const part of raw.split('|')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return fields;
}

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
  const phase = isWarmup ? '워밍업(로그인 전)' : 'C-Rank 세션';
  const fields = parsePipeFields(raw);

  const reasonKey = fields.reason ?? '';
  const reasonLabel = WARMUP_REASON_LABEL[reasonKey] ?? '원인 미분류';
  const urlHint = decodeField(fields.url);
  const titleHint = decodeField(fields.title);
  const screenshot = decodeField(fields.screenshot);
  const rawCount = fields.raw;
  const filteredCount = fields.filtered;
  const mainPack = fields.main_pack;

  let msg = `${phase} 실패(${ctx}) [${reasonLabel}]`;
  if (urlHint) msg += ` · ${urlHint.slice(0, 80)}`;
  if (titleHint) msg += ` · "${titleHint.slice(0, 40)}"`;
  if (rawCount != null) msg += ` · DOM링크 ${rawCount}개`;
  if (filteredCount != null && filteredCount !== '0') msg += `(필터제외 ${filteredCount})`;
  if (mainPack === '0') msg += ' · #main_pack 없음';
  if (screenshot) msg += ` · 스크린샷: ${screenshot.slice(0, 120)}`;

  if (!reasonKey) {
    msg += ' · DOM 변경·봇 감지 가능 — 셀렉터 확인 필요';
  }

  return msg;
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
  if (/Imagen API 실패 \(404\)/.test(raw)) {
    return 'Imagen 4 API 404 — 서버 imagen.ts 엔드포인트·모델명 확인 (i7 배포 필요)';
  }
  if (/Imagen API 실패/.test(raw)) {
    return `Imagen 4 이미지 생성 실패 — ${raw.replace(/^Imagen API 실패\s*/i, '').slice(0, 120)}`;
  }

  return raw;
}
