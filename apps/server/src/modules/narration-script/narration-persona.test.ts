import { describe, expect, it } from 'vitest';
import { buildNarrationDateContext } from './date-context.js';
import { buildNarrationPersonaSystem } from './narration-persona.js';

describe('buildNarrationPersonaSystem', () => {
  it('includes topic, axis, and forbidden CTA', () => {
    const system = buildNarrationPersonaSystem({
      workspace: 'yeonun',
      workspaceLabel: '연운',
      topicLabel: '2026 자미두수 별의 흐름',
      topicHookLabel: '자미두수',
      axisType: 'constellation',
      formatType: 'full_cover',
      periodType: 'weekly',
      dateContext: buildNarrationDateContext('weekly'),
    });
    expect(system).toContain('2026 자미두수 별의 흐름');
    expect(system).toContain('양자리');
    expect(system).toContain('띠·연령대로 바꾸지 말 것');
    expect(system).toMatch(/CTA.*금지/);
    expect(system).toContain('연운');
  });

  it('uses custom persona when provided', () => {
    const system = buildNarrationPersonaSystem(
      {
        workspace: 'yeonun',
        workspaceLabel: '연운',
        topicLabel: '재물운',
        topicHookLabel: '재물운',
        axisType: 'zodiac',
        formatType: 'full_cover',
        periodType: 'daily',
        dateContext: buildNarrationDateContext('daily'),
      },
      '## MC 역할\n테스트 전용 MC',
    );
    expect(system).toContain('운영자 설정');
    expect(system).toContain('테스트 전용 MC');
  });

  it('fortune82 built-in tone when no custom', () => {
    const f82 = buildNarrationPersonaSystem({
      workspace: 'fortune82',
      workspaceLabel: '포춘82',
      topicLabel: '타로',
      topicHookLabel: '타로',
      axisType: 'zodiac',
      formatType: 'ranked',
      periodType: 'daily',
      dateContext: buildNarrationDateContext('daily'),
    });
    expect(f82).toContain('포춘82');
    expect(f82).toContain('TOP5');
    expect(f82).toContain('숏폼 훅');
  });
});

describe('buildDefaultNarrationPersonaText', () => {
  it('yeonun seed persona', async () => {
    const { buildDefaultNarrationPersonaText } = await import('@huma/shared');
    const text = buildDefaultNarrationPersonaText('yeonun');
    expect(text).toContain('연운(yeonun.com)');
    expect(text).toContain('연화·별하·여연·운서');
  });

  it('fortune82 seed persona', async () => {
    const { buildDefaultNarrationPersonaText } = await import('@huma/shared');
    const text = buildDefaultNarrationPersonaText('fortune82');
    expect(text).toContain('포춘82(fortune82.com)');
    expect(text).toContain('자미두수');
  });
});
