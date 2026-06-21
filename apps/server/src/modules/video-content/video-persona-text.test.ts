import { describe, expect, it } from 'vitest';
import {
  filterValidHookTypeOptions,
  parseHookTypeSection,
} from '@huma/shared';

const YEONUN_HOOK_SECTION = `반전 — 예상과 다른 결과가 드러남
예측 범위 자체를 벗어남 — 운세 얘기인 줄 알았는데 전혀
정곡찌르기 — 시청자의 행동이나 심리를 정확히 맞춤
극단적비유 — 운세를 일상적이지 않은 과장된 비유로 표현
클리프행어 — 답을 다 주지 않고 여운으로 끝남 (전체의 20% 이하로 제한)`;

describe('parseHookTypeSection', () => {
  it('extracts only main hook labels from em-dash format', () => {
    const { hookTypes, hookTypeGuidance } = parseHookTypeSection(YEONUN_HOOK_SECTION);
    expect(hookTypes).toEqual(['반전', '정곡찌르기', '극단적비유', '클리프행어']);
    expect(hookTypeGuidance).toContain('운세 얘기인 줄 알았는데');
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

describe('filterValidHookTypeOptions', () => {
  it('filters corrupted hook type strings', () => {
    const valid = filterValidHookTypeOptions([
      '"걱정했는데 사실 잘 됐다" 식의 단순 해피엔딩',
      '반전',
      '정곡찌르기',
    ]);
    expect(valid).toEqual(['반전', '정곡찌르기']);
  });
});
