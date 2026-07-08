import { describe, expect, it } from 'vitest';
import {
  appendNarrationCta,
  appendNarrationScriptFooter,
  buildNarrationCta,
  buildNarrationZodiacDisclaimer,
  stripNarrationFooterLines,
} from './cta-templates.js';

describe('narration cta-templates', () => {
  it('yeonun CTA includes yeonun.com', () => {
    const cta = buildNarrationCta('yeonun', '재회운');
    expect(cta).toContain('연운(yeonun.com)');
    expect(cta).toContain('재회운');
    expect(cta).not.toContain('더 정확한 내 재회운이');
  });

  it('fortune82 CTA includes fortune82.com', () => {
    const cta = buildNarrationCta('fortune82', '타로');
    expect(cta).toContain('포춘82(fortune82.com)');
    expect(cta).toContain('타로');
  });

  it('작명 CTA uses natural phrasing', () => {
    const cta = buildNarrationCta('yeonun', '작명');
    expect(cta).toContain('작명 풀이');
  });

  it('zodiac disclaimer is 면피 only (no URL)', () => {
    expect(buildNarrationZodiacDisclaimer('yeonun')).toBe(
      '같은 띠여도 태어난 해에 따라 흐름이 달라질 수 있어요.',
    );
    expect(buildNarrationZodiacDisclaimer('fortune82')).not.toContain('fortune82.com');
  });

  it('append zodiac footer: one CTA with site link', () => {
    const out = appendNarrationScriptFooter('본문입니다', {
      workspace: 'yeonun',
      hookLabel: '재물운',
      axisType: 'zodiac',
    });
    expect(out).toContain('본문');
    expect(out).toContain('태어난 해');
    expect(out).toContain('재물운');
    expect((out.match(/yeonun\.com/gi) ?? []).length).toBe(1);
  });

  it('no disclaimer for constellation', () => {
    const out = appendNarrationScriptFooter('본문', {
      workspace: 'fortune82',
      hookLabel: '신년운세',
      axisType: 'constellation',
    });
    expect(out).not.toContain('태어난 해');
    expect(out).toContain('fortune82.com');
  });

  it('append adds CTA on new line after body', () => {
    const out = appendNarrationCta('본문입니다', 'yeonun', '재물운');
    expect(out).toMatch(/본문입니다\.?\n/);
    expect(out).toContain('yeonun.com');
  });

  it('strip removes duplicate footer before append', () => {
    const polluted =
      '1위 본문.\n같은 띠여도 태어난 해에 따라 흐름이 달라질 수 있어요.\n' +
      '더 정확한 내 사주 흐름은 연운(yeonun.com)에서 확인해보세요.\n' +
      '더 정확한 재회운이 궁금하다면, 연운(yeonun.com)에서 사주로 확인해보세요. 가입하면 5천 원 크레딧 바로 드려요.';
    const out = appendNarrationScriptFooter(polluted, {
      workspace: 'yeonun',
      hookLabel: '재회운',
      axisType: 'zodiac',
    });
    expect((out.match(/yeonun\.com/gi) ?? []).length).toBe(1);
    expect(out).toContain('재회운');
  });

  it('stripNarrationFooterLines removes CTA-like lines', () => {
    const cleaned = stripNarrationFooterLines(
      '본문\n더 정확한 재회운이 궁금하다면, 연운(yeonun.com)에서 확인해보세요.',
    );
    expect(cleaned).toBe('본문');
  });
});
