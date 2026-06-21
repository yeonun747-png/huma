import { describe, expect, it } from 'vitest';
import {
  buildMetadataTagInstruction,
  metadataTagsFromConditions,
  parseContiMetadataTags,
  validateContiMetadataTags,
} from './conti-metadata.js';

describe('parseContiMetadataTags', () => {
  it('parses metadata line after JSON', () => {
    const raw = `\`\`\`json
{"shots":[]}
\`\`\`
[관계축: 연인] [감정곡선: 평온→충격] [hook_type: 반전] [hook_subtype: 영역 전환] [cut_type: multi_shot] [duration: 15]`;

    expect(parseContiMetadataTags(raw)).toEqual({
      relationshipAxis: '연인',
      emotionCurve: '평온→충격',
      hookType: '반전',
      hookSubtype: '영역 전환',
      cutType: 'multi_shot',
      duration: 15,
    });
  });

  it('parses optional situation axis', () => {
    const raw =
      '[상황축: 카페] [관계축: 캐릭터-일반인] [감정곡선: 무관심→몰입] [hook_type: 정곡찌르기] [hook_subtype: 톤 뒤집기] [cut_type: multi_shot] [duration: 11]';
    expect(parseContiMetadataTags(raw)?.situationAxis).toBe('카페');
  });
});

describe('validateContiMetadataTags', () => {
  it('accepts matching tags', () => {
    const expected = metadataTagsFromConditions({
      relationshipAxis: '연인',
      emotionCurve: '평온→충격',
      hookType: '반전',
      hookSubtype: '영역 전환',
      locationKeyword: '',
      timeOfDay: '',
      cutType: 'multi_shot',
      duration: 15,
    });

    const parsed = { ...expected };
    expect(validateContiMetadataTags(parsed, expected)).toEqual({ ok: true });
  });

  it('rejects hook_subtype mismatch', () => {
    const expected = metadataTagsFromConditions({
      relationshipAxis: '연인',
      emotionCurve: '평온→충격',
      hookType: '반전',
      hookSubtype: '영역 전환',
      locationKeyword: '',
      timeOfDay: '',
      cutType: 'multi_shot',
      duration: 15,
    });

    const parsed = { ...expected, hookSubtype: '정체 반전' };
    const result = validateContiMetadataTags(parsed, expected);
    expect(result.ok).toBe(false);
  });
});

describe('buildMetadataTagInstruction', () => {
  it('includes situation axis when present', () => {
    const line = buildMetadataTagInstruction({
      relationshipAxis: '연인',
      emotionCurve: '평온→충격',
      hookType: '반전',
      hookSubtype: '영역 전환',
      cutType: 'multi_shot',
      duration: 15,
      situationAxis: '카페',
    });
    expect(line).toContain('[상황축: 카페]');
    expect(line).toContain('[hook_subtype: 영역 전환]');
  });
});
