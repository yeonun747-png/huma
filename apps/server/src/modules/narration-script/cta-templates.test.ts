import { describe, expect, it } from 'vitest';
import {
  appendNarrationCta,
  appendNarrationScriptFooter,
  buildNarrationCta,
  buildNarrationZodiacDisclaimer,
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

  it('fortune82 zodiac disclaimer A안', () => {
    const d = buildNarrationZodiacDisclaimer('fortune82');
    expect(d).toContain('포춘82(fortune82.com)');
    expect(d).toContain('태어난 해');
  });

  it('append zodiac footer before CTA for yeonun', () => {
    const out = appendNarrationScriptFooter('본문입니다', {
      workspace: 'yeonun',
      hookLabel: '재물운',
      axisType: 'zodiac',
    });
    expect(out).toContain('본문');
    expect(out).toContain('연운(yeonun.com)');
    expect(out.indexOf('태어난 해')).toBeLessThan(out.indexOf('재물운'));
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
});
