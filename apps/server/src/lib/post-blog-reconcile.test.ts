import { describe, expect, it } from 'vitest';
import { isPostingConnectionError } from './posting-connection-error.js';
import { isPublishedInReconcileWindow, normalizePostTitleForMatch } from './post-blog-reconcile.js';

describe('isPostingConnectionError', () => {
  it('detects SOCKS proxy failures', () => {
    expect(
      isPostingConnectionError(
        'page.goto: net::ERR_SOCKS_CONNECTION_FAILED at https://nid.naver.com/nidlogin.login',
      ),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isPostingConnectionError('BLOG_TITLE_NOT_FOUND')).toBe(false);
  });
});

describe('normalizePostTitleForMatch', () => {
  it('normalizes whitespace and case', () => {
    expect(normalizePostTitleForMatch('  오늘  하루  운세 ')).toBe('오늘 하루 운세');
  });
});

describe('isPublishedInReconcileWindow', () => {
  it('rejects missing publishedAt (no Date.now fallback)', () => {
    const since = Date.now() - 60 * 60_000;
    expect(isPublishedInReconcileWindow(null, since)).toBe(false);
    expect(isPublishedInReconcileWindow('', since)).toBe(false);
  });

  it('rejects posts published before job window', () => {
    const since = Date.now() - 60 * 60_000;
    const old = new Date(since - 24 * 60 * 60_000).toISOString();
    expect(isPublishedInReconcileWindow(old, since)).toBe(false);
  });

  it('accepts posts published after job window start', () => {
    const since = Date.now() - 60 * 60_000;
    const recent = new Date(since + 5 * 60_000).toISOString();
    expect(isPublishedInReconcileWindow(recent, since)).toBe(true);
  });
});
