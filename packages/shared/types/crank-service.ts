import type { Workspace } from './account';
import { crankLabelSortKey, crankLetterLabel } from './crank-label';

/** v3.28 — C-Rank 50계정 서비스별 배정 (CRANK-A~AX) */
export const CRANK_SERVICE_ASSIGNMENTS = {
  yeonun: {
    startIndex: 0,
    count: 25,
    labelKo: '연운',
    rangeStart: 'CRANK-A',
    rangeEnd: 'CRANK-Y',
  },
  panana: {
    startIndex: 25,
    count: 15,
    labelKo: '파나나',
    rangeStart: 'CRANK-Z',
    rangeEnd: 'CRANK-AN',
  },
  quizoasis: {
    startIndex: 40,
    count: 10,
    labelKo: '퀴즈오아시스',
    rangeStart: 'CRANK-AO',
    rangeEnd: 'CRANK-AX',
  },
} as const satisfies Record<
  Workspace,
  { startIndex: number; count: number; labelKo: string; rangeStart: string; rangeEnd: string }
>;

export const CRANK_SERVICE_ORDER: Workspace[] = ['yeonun', 'panana', 'quizoasis'];

/** 기획서 §8-7 social_crank.keyword_pools 기본값 */
export const DEFAULT_CRANK_KEYWORD_POOLS: Record<Workspace, string[]> = {
  yeonun: [
    '사주풀이',
    '오늘운세',
    '신년운세',
    '꿈해몽',
    '궁합',
    '재회사주',
    '이직사주',
    '명리학',
    '자미두수',
    '사주명리',
    '띠별운세',
    '타로',
    '관상',
    '점집후기',
  ],
  panana: [
    '감성일기',
    '새벽감성',
    '위로글',
    '웹소설추천',
    'AI캐릭터',
    '감성소설',
    '혼자있고싶을때',
    '새벽3시',
    '연애감성',
    '힐링글',
    '감성브이로그',
  ],
  quizoasis: [
    'MBTI테스트',
    '심리테스트',
    '성격유형',
    '연애유형',
    '직업적성',
    '퀴즈풀기',
    '두뇌퀴즈',
    '심리분석',
    '퍼즐',
    '공감테스트',
  ],
};

export function crankWorkspaceForIndex(index: number): Workspace {
  if (index < CRANK_SERVICE_ASSIGNMENTS.yeonun.count) return 'yeonun';
  if (index < CRANK_SERVICE_ASSIGNMENTS.yeonun.count + CRANK_SERVICE_ASSIGNMENTS.panana.count) {
    return 'panana';
  }
  return 'quizoasis';
}

/** CRANK-A=0 … CRANK-Y=24 / Z~AN / AO~AX */
export function crankWorkspaceFromLabel(label: string | null | undefined): Workspace | null {
  const key = crankLabelSortKey(label);
  if (key < 0 || key >= 50) return null;
  return crankWorkspaceForIndex(key);
}

export function crankServiceLabelKo(workspace: Workspace): string {
  return CRANK_SERVICE_ASSIGNMENTS[workspace].labelKo;
}

export function crankLabelForServiceIndex(workspace: Workspace, indexInService: number): string {
  const start = CRANK_SERVICE_ASSIGNMENTS[workspace].startIndex;
  return crankLetterLabel(start + indexInService);
}
