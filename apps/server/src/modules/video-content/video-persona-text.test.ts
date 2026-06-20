import { describe, expect, it } from 'vitest';
import {
  filterValidHookTypeOptions,
  parseHookTypeSection,
  parseVideoPersonaText,
} from '@huma/shared';
import { pickHookType } from './selection.js';
import { DEFAULT_VIDEO_PERSONAS } from './types.js';

const YEONUN_HOOK_SECTION = `반전 — 예상과 다른 결과가 드러남
예측 범위 자체를 벗어남 — 운세 얘기인 줄 알았는데 전혀
인물의 정체나 역할이 뒤집힘 — 의심하던 대상이 사실은
본인이었다, 도와주던 사람이 사실 당사자였다 등
기대의 정반대가 시각적 증거로 드러남 — 단순 대사가 아니라
"걱정했는데 사실 잘 됐다" 식의 단순 해피엔딩
한쪽 주장이 그냥 맞았다고 확인되는 결말
추상적인 대사로만 결론 내리고 구체적 증거나 각도 전환이 없음
정곡찌르기 — 시청자의 행동이나 심리를 정확히 맞춤
극단적비유 — 운세를 일상적이지 않은 과장된 비유로 표현
클리프행어 — 답을 다 주지 않고 여운으로 끝남 (전체의 20% 이하로 제한)`;

describe('parseHookTypeSection', () => {
  it('extracts only main hook labels from em-dash format', () => {
    const { hookTypes, hookTypeGuidance } = parseHookTypeSection(YEONUN_HOOK_SECTION);
    expect(hookTypes).toEqual(['반전', '정곡찌르기', '극단적비유', '클리프행어']);
    expect(hookTypeGuidance).toContain('걱정했는데');
    expect(hookTypes).not.toContain('"걱정했는데 사실 잘 됐다" 식의 단순 해피엔딩');
  });

  it('supports A./B. bullet option block before blank line', () => {
    const body = `A. 반전
B. 정곡찌르기
C. 극단적비유
D. 클리프행어

금지 예시 문장`;
    const { hookTypes, hookTypeGuidance } = parseHookTypeSection(body);
    expect(hookTypes).toEqual(['반전', '정곡찌르기', '극단적비유', '클리프행어']);
    expect(hookTypeGuidance).toContain('금지');
  });
});

describe('pickHookType whitelist', () => {
  it('never picks invalid labels from corrupted hookTypes', () => {
    const config = {
      ...DEFAULT_VIDEO_PERSONAS.yeonun,
      hookTypes: ['"걱정했는데 사실 잘 됐다" 식의 단순 해피엔딩', '반전', '정곹찌르기'],
    };
    for (let i = 0; i < 20; i++) {
      const picked = pickHookType(config, [], DEFAULT_VIDEO_PERSONAS.yeonun.hookTypes);
      expect(filterValidHookTypeOptions([picked])).toEqual([picked]);
      expect(picked).not.toMatch(/걱정|해피엔딩/);
    }
  });
});

describe('parseVideoPersonaText axes', () => {
  it('keeps short relationship and emotion lines as options only', () => {
    const text = `## 관계축
연인
친구
가족

## 감정곡선
갈등→해소
평온→충격

## 펀치라인 메커니즘
A. 반전
B. 정곹찌르기

## 컷 구성
multi_shot

## 샷 구조
11~15초

## 서비스 제약
연운 제약`;
    const { config } = parseVideoPersonaText(text, 'yeonun');
    expect(config.relationshipAxes).toEqual(['연인', '친구', '가족']);
    expect(config.emotionCurves).toEqual(['갈등→해소', '평온→충격']);
    expect(filterValidHookTypeOptions(config.hookTypes)).toEqual(['반전', '정곹찌르기']);
  });
});
