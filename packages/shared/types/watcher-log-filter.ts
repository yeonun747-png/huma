const VIDEO_CONTENT_PREFIXES = ['[video-content]', '[evolink]', '[video-content-storage]'] as const;

/** worker가 prefix 없이 남긴 숏폼 영상관리 ERROR (과거 이력 필터용) */
const VIDEO_CONTENT_UNPREFIXED = [
  /^EvoLink\b/i,
  /^EVOLINK_API_KEY/,
  /^프롬프트 길이 초과$/,
  /^콘티 데이터 없음$/,
  /^히스토리 없음$/,
  /^영상 제작 불가 상태:/,
  /^자막 (재입히기|입히기)/,
  /^계정 없음$/,
  /^작업 없음$/,
  /^3[ab]단계/,
  /^펀치라인 아이디어/,
  /^퀴즈 API/,
  /^파나나 캐릭터 API/,
  /Unterminated string in JSON/i,
] as const;

/** 숏폼 영상관리(콘티·렌더·EvoLink·스토리지) 운영 로그 — Layer4 Watcher에서 제외 */
export function isVideoContentOperationalLog(message: string | null | undefined): boolean {
  const msg = String(message ?? '').trim();
  if (!msg) return false;
  const lower = msg.toLowerCase();
  for (const prefix of VIDEO_CONTENT_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) return true;
  }
  return VIDEO_CONTENT_UNPREFIXED.some((re) => re.test(msg));
}
