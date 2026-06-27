import type { BrowserContext } from 'playwright';

/**
 * 원격접속·post_blog·C-Rank — 동일 리소스 차단 (화면 표시 일치).
 * CSS·폰트·UI아이콘 허용, 배너·사진·영상·광고만 차단. login/captcha/editor는 예외.
 */

const AD_HOST_SNIPPETS = ['ader.naver.com', 'ads.naver.com', 'ad.doubleclick.net', 'googlesyndication.com'];

const armedContexts = new WeakSet<BrowserContext>();

function urlLower(url: string): string {
  return url.trim().toLowerCase();
}

function isAdHost(url: string): boolean {
  const u = urlLower(url);
  return AD_HOST_SNIPPETS.some((snippet) => u.includes(snippet));
}

/** favicon·sprite·svg 등 소형 UI — 레이아웃 유지용 (용량 미미) */
export function isLightweightImageUrl(url: string): boolean {
  const u = urlLower(url);
  if (/\.(?:svg|ico)(?:\?|$)/i.test(u)) return true;
  if (u.includes('favicon')) return true;
  if (/\/ico\//i.test(u) || u.includes('sprite') || u.includes('icon_')) return true;
  return false;
}

/**
 * 사진·배너 등 대용량 image 차단 — CSS·폰트·아이콘은 통과.
 */
export function shouldBlockHeavyImage(url: string, resourceType: string): boolean {
  if (resourceType.toLowerCase() !== 'image') return false;
  return !isLightweightImageUrl(url);
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

function isEditorReferer(referer?: string): boolean {
  return Boolean(referer && BLOG_EDITOR_RE.test(referer));
}

/** 블로그 에디터·발행 확인 — JS/CSS·에디터 UI */
export function isBlogEditorOrPublishContext(url: string, referer?: string): boolean {
  const u = urlLower(url);
  const ref = urlLower(referer ?? '');
  if (/blog\.naver\.com|m\.blog\.naver\.com/i.test(u) && BLOG_EDITOR_RE.test(u)) return true;
  if (BLOG_EDITOR_RE.test(ref)) return true;
  return false;
}

/** C-Rank·발행 후 포스트 열람 */
export function isBlogPostReadContext(url: string, referer?: string): boolean {
  const u = urlLower(url);
  const ref = urlLower(referer ?? '');
  return /blog\.naver\.com|m\.blog\.naver\.com/i.test(u) || /blog\.naver\.com|m\.blog\.naver\.com/i.test(ref);
}

/** 에디터·발행 확인 — 삽입/업로드 본문 이미지 포함 전부 허용 */
function shouldAllowEditorImage(url: string, resourceType: string, referer?: string): boolean {
  if (resourceType.toLowerCase() !== 'image') return false;
  return isBlogEditorOrPublishContext(url, referer) || isEditorReferer(referer);
}

/** 영상 + 대용량 image — 공통 차단 (CSS·font·JS·XHR 유지) */
function shouldBlockBalancedDecorative(url: string, resourceType: string): boolean {
  const type = resourceType.toLowerCase();
  if (type === 'media') return true;
  if (shouldBlockHeavyImage(url, type)) return true;
  return false;
}

/** true → route.abort() */
export function shouldAbortNaverResource(
  url: string,
  resourceType: string,
  referer?: string,
): boolean {
  const type = resourceType.toLowerCase();

  if (isAdHost(url)) return true;

  if (isLoginOrCaptchaUrl(url)) return false;
  if (referer && isLoginOrCaptchaUrl(referer) && (type === 'image' || type === 'script' || type === 'stylesheet')) {
    return false;
  }

  if (type === 'image' && shouldAllowEditorImage(url, type, referer)) {
    return false;
  }

  if (isBlogEditorOrPublishContext(url, referer) || isEditorReferer(referer)) {
    return type === 'media';
  }

  if (isBlogPostReadContext(url, referer)) {
    return shouldBlockBalancedDecorative(url, type);
  }

  return shouldBlockBalancedDecorative(url, type);
}

/** 원격접속·자동화 공통 — context당 1회 등록 */
export async function applyNaverResourceBlocking(context: BrowserContext): Promise<void> {
  if (armedContexts.has(context)) return;
  armedContexts.add(context);

  await context.route('**/*', async (route) => {
    const req = route.request();
    const referer = req.headers()['referer'] ?? req.headers()['Referer'];

    if (shouldAbortNaverResource(req.url(), req.resourceType(), referer)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}
