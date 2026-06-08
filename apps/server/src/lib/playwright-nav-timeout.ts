/** LTE 동글 SOCKS — Playwright 기본 30s navigation은 domcontentloaded까지 부족 */
export const PLAYWRIGHT_NAV_TIMEOUT_MS = (() => {
  const raw = Number(process.env.HUMA_PLAYWRIGHT_NAV_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 90_000;
})();

/** C-Rank 워밍업·방문 — 90s는 과도, 느린 URL은 safeGoto 스킵 */
export const CRANK_NAV_TIMEOUT_MS = (() => {
  const raw = Number(process.env.HUMA_CRANK_NAV_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 20_000) return raw;
  return 60_000;
})();
