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
  });

  it('fortune82 CTA includes fortune82.com', () => {
    const cta = buildNarrationCta('fortune82', '타로');
    expect(cta).toContain('포춘82(fortune82.com)');
    expect(cta).toContain('타로');
  });

  it('fortune82 zodiac disclaimer A안', () => {
    const d = buildNarrationZodiacDisclaimer('fortune82');
    expect(d).toContain('포춘82(fortune82.com)');
    expect(d).toContain('태어난 해');
  });

  it('append zodiac footer before CTA for yeonun', () => {
    const out = appendNarrationScriptFooter('본문입니다', {
      workspace: 'yeonun',
      productTitle: '운세',
      axisType: 'zodiac',
    });
    expect(out).toContain('본문');
    expect(out).toContain('연운(yeonun.com)');
    expect(out.indexOf('태어난 해')).toBeLessThan(out.indexOf('더 정확한 내'));
  });

  it('no disclaimer for constellation', () => {
    const out = appendNarrationScriptFooter('본문', {
      workspace: 'fortune82',
      productTitle: '운세',
      axisType: 'constellation',
    });
    expect(out).not.toContain('태어난 해');
    expect(out).toContain('fortune82.com');
  });

  it('append adds CTA on new line after body', () => {
    const out = appendNarrationCta('본문입니다', 'yeonun', '운세');
    expect(out).toMatch(/본문입니다\.?\n더 정확한/);
    expect(out).toContain('yeonun.com');
  });
});
