import type { NarrationAxisType } from '@huma/shared';

export interface AxisInstance {
  key: string;
  label: string;
}

export const ZODIAC_INSTANCES: AxisInstance[] = [
  { key: 'rat', label: '쥐띠' },
  { key: 'ox', label: '소띠' },
  { key: 'tiger', label: '호랑이띠' },
  { key: 'rabbit', label: '토끼띠' },
  { key: 'dragon', label: '용띠' },
  { key: 'snake', label: '뱀띠' },
  { key: 'horse', label: '말띠' },
  { key: 'goat', label: '양띠' },
  { key: 'monkey', label: '원숭이띠' },
  { key: 'rooster', label: '닭띠' },
  { key: 'dog', label: '개띠' },
  { key: 'pig', label: '돼지띠' },
];

export const CONSTELLATION_INSTANCES: AxisInstance[] = [
  { key: 'aries', label: '양자리' },
  { key: 'taurus', label: '황소자리' },
  { key: 'gemini', label: '쌍둥이자리' },
  { key: 'cancer', label: '게자리' },
  { key: 'leo', label: '사자자리' },
  { key: 'virgo', label: '처녀자리' },
  { key: 'libra', label: '천칭자리' },
  { key: 'scorpio', label: '전갈자리' },
  { key: 'sagittarius', label: '사수자리' },
  { key: 'capricorn', label: '염소자리' },
  { key: 'aquarius', label: '물병자리' },
  { key: 'pisces', label: '물고기자리' },
];

export const GENERATION_INSTANCES: AxisInstance[] = [
  { key: 'gen60', label: '60년대생' },
  { key: 'gen70', label: '70년대생' },
  { key: 'gen80', label: '80년대생' },
  { key: 'gen90', label: '90년대생' },
  { key: 'gen00', label: '00년대생' },
];

export function axisInstances(axis: NarrationAxisType): AxisInstance[] {
  if (axis === 'zodiac') return ZODIAC_INSTANCES;
  if (axis === 'constellation') return CONSTELLATION_INSTANCES;
  return GENERATION_INSTANCES;
}

export function axisInstanceLabels(axis: NarrationAxisType): string[] {
  return axisInstances(axis).map((i) => i.label);
}

export const ALL_AXIS_TYPES: NarrationAxisType[] = ['zodiac', 'constellation', 'generation'];
