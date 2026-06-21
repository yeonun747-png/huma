import { describe, expect, it } from 'vitest';
import {
  buildHookTypePromptBlock,
  extractAxisOptions,
  extractHookMechanismBlock,
  extractHookMechanisms,
  extractHookSubtypes,
} from './persona-axis.js';

const SAMPLE = `## 관계축
- 연인
- 친구
- 직장

## 감정곡선
- 무관심→몰입
- 평온→충격

## 펀치라인 메커니즘
A. 반전 — 예상과 다른 결과
반전은 예상과 다른 각도에서 와야 한다.
B. 정곡찌르기 — 시청자 심리를 맞춤

## hook_subtype
- 정체 반전
- 영역 전환
- 동시성 반전

## 서비스 제약
서비스: 연운
`;

describe('extractAxisOptions', () => {
  it('extracts bullet options only, ignores prose', () => {
    expect(extractAxisOptions(SAMPLE, '관계축')).toEqual(['연인', '친구', '직장']);
    expect(extractAxisOptions(SAMPLE, '감정곡선')).toEqual(['무관심→몰입', '평온→충격']);
  });

  it('does not treat prose lines as options', () => {
    expect(extractAxisOptions(SAMPLE, '펀치라인 메커니즘')).toEqual([]);
  });
});

describe('extractHookMechanisms', () => {
  it('parses A-D mechanism labels', () => {
    expect(extractHookMechanisms(SAMPLE)).toEqual(['반전', '정곡찌르기']);
  });
});

describe('extractHookSubtypes', () => {
  it('reads hook_subtype bullets', () => {
    expect(extractHookSubtypes(SAMPLE)).toEqual(['정체 반전', '영역 전환', '동시성 반전']);
  });
});

describe('extractHookMechanismBlock', () => {
  it('extracts selected mechanism lines until next header', () => {
    expect(extractHookMechanismBlock(SAMPLE, '반전')).toBe(
      'A. 반전 — 예상과 다른 결과\n반전은 예상과 다른 각도에서 와야 한다.',
    );
    expect(extractHookMechanismBlock(SAMPLE, '정곡찌르기')).toBe(
      'B. 정곡찌르기 — 시청자 심리를 맞춤',
    );
  });
});

describe('buildHookTypePromptBlock', () => {
  it('includes hook_type label and mechanism definition', () => {
    const block = buildHookTypePromptBlock(SAMPLE, '정곡찌르기');
    expect(block).toContain('hook_type은 "정곡찌르기"');
    expect(block).toContain('시청자 심리를 맞춤');
  });
});
