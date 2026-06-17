import { describe, expect, it } from 'vitest';
import { plainTextLength } from './blog-url.js';

describe('plainTextLength', () => {
  it('keeps newlines but strips markdown syntax', () => {
    const md = '# 제목\n\n첫 문단입니다.\n\n둘째 문단.';
    expect(plainTextLength(md)).toBe('제목\n\n첫 문단입니다.\n\n둘째 문단.'.length);
  });

  it('drops image markdown from char count', () => {
    const md = '본문 시작\n\n![alt](https://example.com/a.jpg)\n\n본문 끝';
    expect(plainTextLength(md)).toBe('본문 시작\n\n\n\n본문 끝'.length);
  });
});
