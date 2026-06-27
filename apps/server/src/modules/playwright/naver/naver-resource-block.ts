import type { BrowserContext } from 'playwright';

/** warmup·workflow·VNC 모두 동일 차단 — login/captcha/editor URL은 자동 예외 */
export type NaverResourceBlockProfile = 'warmup' | 'workflow' | 'vnc_lite';

const AD_HOST_SNIPPETS = ['ader.naver.com', 'ads.naver.com', 'ad.doubleclick.net', 'googlesyndication.com'];

const armedContexts = new WeakSet<BrowserContext>();
const profileByContext = new WeakMap<BrowserContext, NaverResourceBlockProfile>();

function urlLower(url: string): string {
  return url.trim().toLowerCase();
}

function isAdHost(url: string): boolean {
  const u = urlLower(url);
  return AD_HOST_SNIPPETS.some((snippet) => u.includes(snippet));
}

/** nid 로그인·캡cha — 이미지·스크립트 모두 필요 */
export function isLoginOrCaptchaUrl(url: string): boolean {
  const u = urlLower(url);
  return (
    u.includes('nid.naver.com') ||
    u.includes('captcha.naver.com') ||
    /\/captcha(?:[/?]|$)/i.test(u)
  );
}

const BLOG_EDITOR_RE = /postwrite|postwriteform|goblogwrite|postview\.naver/i;

/** 블로그 에디터·발행 확인 — JS/CSS 유지 */
export function isBlogEditorOrPublishContext(url: string, referer?: string): boolean {
  const u = urlLower(url);
  const ref = urlLower(referer ?? '');
  if (/blog\.naver\.com|m\.blog\.naver\.com/i.test(u) && BLOG_EDITOR_RE.test(u)) return true;
  if (BLOG_EDITOR_RE.test(ref)) return true;
  return false;
}

/** C-Rank·발행 후 포스트 열람 — JS 필요, 장식 리소스 차단 */
export function isBlogPostReadContext(url: string, referer?: string): boolean {
  const u = urlLower(url);
  const ref = urlLower(referer ?? '');
  return /blog\.naver\.com|m\.blog\.naver\.com/i.test(u) || /blog\.naver\.com|m\.blog\.naver\.com/i.test(ref);
}

/**
 * true → route.abort()
 * 포스팅·워밍업·VNC — naver 장식(이미지·CSS·폰트·광고) 최소화, login/captcha/editor는 예외.
 */
export function shouldAbortNaverResource(
  url: string,
  resourceType: string,
  _profile: NaverResourceBlockProfile = 'workflow',
  referer?: string,
): boolean {
  const type = resourceType.toLowerCase();

  if (isAdHost(url)) return true;

  if (isLoginOrCaptchaUrl(url)) return false;
  if (referer && isLoginOrCaptchaUrl(referer) && (type === 'image' || type === 'script' || type === 'stylesheet')) {
    return false;
  }

  if (isBlogEditorOrPublishContext(url, referer)) {
    if (type === 'media' || type === 'font') return true;
    return false;
  }

  if (isBlogPostReadContext(url, referer)) {
    if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') return true;
    return false;
  }

  if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') return true;

  return false;
}

export function setNaverResourceBlockProfile(
  context: BrowserContext,
  profile: NaverResourceBlockProfile,
): void {
  profileByContext.set(context, profile);
}

/**
 * 브라우저 context당 1회 등록 — 이후 setNaverResourceBlockProfile 로 프로필만 변경.
 */
export async function applyNaverResourceBlocking(
  context: BrowserContext,
  profile: NaverResourceBlockProfile = 'workflow',
): Promise<void> {
  profileByContext.set(context, profile);

  if (armedContexts.has(context)) return;
  armedContexts.add(context);

  await context.route('**/*', async (route) => {
    const activeProfile = profileByContext.get(context) ?? 'workflow';
    const req = route.request();
    const referer = req.headers()['referer'] ?? req.headers()['Referer'];

    if (shouldAbortNaverResource(req.url(), req.resourceType(), activeProfile, referer)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}
