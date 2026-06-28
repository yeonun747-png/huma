import { describe, expect, it } from 'vitest';

import {
  extractPostingSubjectKey,
  filterPostingSubjectCandidates,
} from './posting-recent-subjects.js';

describe('extractPostingSubjectKey', () => {
  it('parses yeonun fortune slug', () => {
    expect(
      extractPostingSubjectKey('yeonun', 'https://yeonun.com/fortune/future-spouse'),
    ).toBe('future-spouse');
  });

  it('parses quiz test slug', () => {
    expect(
      extractPostingSubjectKey('quizoasis', 'https://www.myquizoasis.com/ko/test/mbti-love'),
    ).toBe('mbti-love');
  });

  it('parses panana character id', () => {
    expect(extractPostingSubjectKey('panana', 'https://panana.kr/c/char-42')).toBe('char-42');
  });
});

describe('filterPostingSubjectCandidates', () => {
  const items = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];

  it('excludes recent keys when alternatives exist', () => {
    const out = filterPostingSubjectCandidates(items, (i) => i.slug, new Set(['a', 'b']));
    expect(out.map((i) => i.slug)).toEqual(['c']);
  });

  it('keeps all when every candidate is recent', () => {
    const out = filterPostingSubjectCandidates(items, (i) => i.slug, new Set(['a', 'b', 'c']));
    expect(out).toEqual(items);
  });
});
