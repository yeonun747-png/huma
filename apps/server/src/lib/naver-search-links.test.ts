import { describe, expect, it } from 'vitest';
import { isIntegratedWarmupLink, isShoppingWarmupTarget } from './naver-search-links.js';

describe('isShoppingWarmupTarget', () => {
  it('detects shopping domains and tab params', () => {
    expect(isShoppingWarmupTarget('https://shopping.naver.com/ns/home')).toBe(true);
    expect(isShoppingWarmupTarget('https://search.shopping.naver.com/search/all?query=운세')).toBe(true);
    expect(
      isShoppingWarmupTarget('https://search.naver.com/search.naver?ssc=tab.shopping&query=운세'),
    ).toBe(true);
    expect(isShoppingWarmupTarget('https://search.naver.com/search.naver?where=shopping&query=x')).toBe(
      true,
    );
  });

  it('detects shopping by link text', () => {
    expect(isShoppingWarmupTarget('https://www.naver.com/', '쇼핑')).toBe(true);
  });

  it('allows non-shopping warmup links', () => {
    expect(isShoppingWarmupTarget('https://news.naver.com/')).toBe(false);
    expect(isShoppingWarmupTarget('https://cafe.naver.com/foo')).toBe(false);
  });
});

describe('isIntegratedWarmupLink', () => {
  it('rejects shopping URLs from integrated search results', () => {
    expect(isIntegratedWarmupLink('https://shopping.naver.com/catalog/123')).toBe(false);
    expect(isIntegratedWarmupLink('https://n.news.naver.com/article/1')).toBe(true);
  });
});
