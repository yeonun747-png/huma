/** 블로그 지수 — 계정당 노출 검사·목록 표시 상한 */
export const BLOG_CHECK_POST_LIMIT = 10;

/** 포스트 간 스캔 간격 (ms) */
export const BLOG_CHECK_SCAN_DELAY_MIN_MS = 200;
export const BLOG_CHECK_SCAN_DELAY_MAX_MS = 600;

/** 전체 스캔 — 계정 간 브라우저 재시작 전 대기 (ms) */
export const BLOG_CHECK_ACCOUNT_GAP_MS = 5_000;

/** waitFor 이후 DOM 안정화 버퍼 (ms) */
export const BLOG_CHECK_PAGE_SETTLE_MS = 300;

/** iframe/본문 selector 대기 타임아웃 (ms) */
export const BLOG_CHECK_FRAME_TIMEOUT_MS = 12_000;
