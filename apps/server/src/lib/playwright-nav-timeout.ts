/** LTE 동글 SOCKS — Playwright 기본 30s navigation은 domcontentloaded까지 부족 */
export const PLAYWRIGHT_NAV_TIMEOUT_MS = (() => {
  const raw = Number(process.env.HUMA_PLAYWRIGHT_NAV_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 90_000;
})();
