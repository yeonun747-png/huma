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
    'AI친구',
    'AI캐릭터',
    '캐릭터챗봇',
    'AI채팅',
    '감성AI',
    'AI대화',
    'AI소울메이트',
    '새벽감성',
    '위로글',
    '감성일기',
    '혼자있고싶을때',
    'AI남자친구',
    'AI여자친구',
    '감성채팅',
    '외로울때',
  ],
  quizoasis: [
    'MBTI 테스트',
    '심리테스트',
    '성격테스트',
    '연애테스트',
    '성격유형검사',
    '무료MBTI',
    'MBTI궁합',
    '연애유형테스트',
    '직업적성테스트',
    '퍼스널컬러테스트',
    '에니어그램',
    '애착유형테스트',
    '직장인테스트',
    '공감능력테스트',
    '두뇌유형테스트',
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
