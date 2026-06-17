/** 블로그 지수 — 계정당 노출 검사·목록 표시 상한 */
export const BLOG_CHECK_POST_LIMIT = 10;

/** 포스트 간 스캔 간격 (ms) */
export const BLOG_CHECK_SCAN_DELAY_MIN_MS = 50;
export const BLOG_CHECK_SCAN_DELAY_MAX_MS = 120;

/** 전체 스캔 — 계정 간 브라우저 재시작 전 대기 (ms) */
export const BLOG_CHECK_ACCOUNT_GAP_MS = 5_000;

/** waitFor 이후 DOM 안정화 버퍼 (ms) */
export const BLOG_CHECK_PAGE_SETTLE_MS = 120;

/** 네이버 검색 결과 페이지 — 짧은 settle */
export const BLOG_CHECK_SEARCH_SETTLE_MS = 80;

/** iframe/본문 selector 대기 타임아웃 (ms) */
export const BLOG_CHECK_FRAME_TIMEOUT_MS = 6_000;

/** 네이버 검색 locator 대기 (ms) */
export const BLOG_CHECK_SEARCH_WAIT_MS = 4_000;
