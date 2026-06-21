import { describe, expect, it } from 'vitest';
import {
  filterFilmableMustIncludeProps,
  materialAppearsInShotText,
  parseCoreMaterialTagsFromResponse,
  validateCoreMaterials,
} from './punchline-material.js';
import type { VideoContiShot } from './types.js';

describe('filterFilmableMustIncludeProps', () => {
  it('removes screen-text-like props', () => {
    expect(
      filterFilmableMustIncludeProps(['반지 케이스', '사주 결과 페이지', '스마트폰']),
    ).toEqual(['반지 케이스', '스마트폰']);
  });
});

describe('parseCoreMaterialTagsFromResponse', () => {
  it('parses 핵심소재 tag line', () => {
    const raw = `\`\`\`json\n{"shots":[]}\n\`\`\`\n[핵심소재: 반지 케이스 → 샷4, 스마트폰 → 샷2]`;
    expect(parseCoreMaterialTagsFromResponse(raw)).toEqual([
      { material: '반지 케이스', shotNumber: 4 },
      { material: '스마트폰', shotNumber: 2 },
    ]);
  });
});

describe('validateCoreMaterials', () => {
  const shots: VideoContiShot[] = [
    { shotNumber: 1, startSec: 0, endSec: 3, camera: '와이드', action: '카페', dialogue: '' },
    {
      shotNumber: 2,
      startSec: 3,
      endSec: 6,
      camera: '미디엄',
      action: 'B가 스마트폰을 테이블에 둔다',
      dialogue: '',
    },
    { shotNumber: 3, startSec: 6, endSec: 9, camera: '와이드', action: '대화', dialogue: '' },
    {
      shotNumber: 4,
      startSec: 9,
      endSec: 13,
      camera: '클로즈',
      action: '재킷 주머니에서 반지 케이스 모서리가 보인다',
      dialogue: '',
    },
  ];

  it('passes when props appear in tagged shots', () => {
    const result = validateCoreMaterials({
      mustIncludeProps: ['반지 케이스', '스마트폰'],
      placements: [
        { material: '반지 케이스', shotNumber: 4 },
        { material: '스마트폰', shotNumber: 2 },
      ],
      shots,
    });
    expect(result.ok).toBe(true);
  });

  it('fails when prop missing from shots', () => {
    const result = validateCoreMaterials({
      mustIncludeProps: ['반지 케이스', '우산'],
      placements: [
        { material: '반지 케이스', shotNumber: 4 },
        { material: '우산', shotNumber: 2 },
      ],
      shots,
    });
    expect(result.ok).toBe(false);
  });
});

describe('materialAppearsInShotText', () => {
  it('matches multi-token material', () => {
    expect(
      materialAppearsInShotText('반지 케이스', '주머니에서 반지 케이스가 삐져나온다', ''),
    ).toBe(true);
  });
});
