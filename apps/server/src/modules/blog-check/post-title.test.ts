import { describe, expect, it } from 'vitest';

import { preferBlogListTitleForSearch } from './post-title.js';

describe('preferBlogListTitleForSearch', () => {
  it('prefers live blog list title over DB title', () => {
    expect(
      preferBlogListTitleForSearch(
        '미래 배우자 특성 무료로 알아보기 연운',
        '미래 배우자 특성 무료로 알아보기 | 연운',
      ),
    ).toBe('미래 배우자 특성 무료로 알아보기 연운');
  });

  it('falls back to DB title when list title missing', () => {
    expect(preferBlogListTitleForSearch(null, 'DB 제목')).toBe('DB 제목');
  });
});
