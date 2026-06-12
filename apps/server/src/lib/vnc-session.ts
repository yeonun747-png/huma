/** Xvfb :99 headful — VNC로 브라우저를 직접 보는 세션 */
export function isVncHeadfulSession(): boolean {
  return (
    process.platform === 'linux' &&
    process.env.DISPLAY === ':99' &&
    process.env.PLAYWRIGHT_HEADLESS !== 'true'
  );
}

/** VNC 관찰 시 불필요한 대기 축소 (HUMA_VNC_FAST=false 로 끔) */
export function vncFastSleepScale(): number {
  if (!isVncHeadfulSession()) return 1;
  if (process.env.HUMA_VNC_FAST === 'false') return 1;
  return 0.55;
}
