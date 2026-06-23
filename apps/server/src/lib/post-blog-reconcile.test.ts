import { describe, expect, it } from 'vitest';
import { isPostingConnectionError } from './posting-connection-error.js';
import { normalizePostTitleForMatch } from './post-blog-reconcile.js';

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
