import { describe, expect, it } from 'vitest';
import {
  buildNarrationCtaLead,
  deriveNarrationHookLabel,
  titleContainsCatalogName,
  titleIncludesHook,
} from './topic-hook.js';

describe('deriveNarrationHookLabel', () => {
  it('shortens catalog titles', () => {
    expect(deriveNarrationHookLabel('아이 이름 작명 · 평생을 따라갈 글자')).toBe('작명');
    expect(deriveNarrationHookLabel('2026 일년 신년운세')).toBe('신년운세');
    expect(deriveNarrationHookLabel('그 사람과 다시 만날 수 있을까')).toBe('재회운');
  });

  it('keeps short product names', () => {
    expect(deriveNarrationHookLabel('재물운')).toBe('재물운');
  });
});

describe('titleIncludesHook', () => {
  it('matches hook or stem', () => {
    expect(titleIncludesHook('오늘 작명 기운 좋은 띠 TOP5', '작명')).toBe(true);
    expect(titleIncludesHook('이번 주 별자리 신년운세, 당신은?', '신년운세')).toBe(true);
  });
});

describe('titleContainsCatalogName', () => {
  it('detects long catalog names in title', () => {
    expect(
      titleContainsCatalogName(
        '이달 띠별로 알아보는 아이 이름 작명 TOP12',
        '아이 이름 작명 · 평생을 따라갈 글자',
      ),
    ).toBe(true);
  });
});

describe('buildNarrationCtaLead', () => {
  it('uses natural phrasing per hook', () => {
    expect(buildNarrationCtaLead('작명')).toContain('작명 풀이');
    expect(buildNarrationCtaLead('신년운세')).toContain('올해');
    expect(buildNarrationCtaLead('재회운')).toContain('재회운이');
  });
});
