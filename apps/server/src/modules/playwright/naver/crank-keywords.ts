import { shuffleArray } from '../../../lib/utils.js';

/** v3.25 §7-15 — C-Rank 탐색 키워드 풀 */
export const CRANK_KEYWORD_POOL: Record<string, string[]> = {
  연애: ['짝사랑', '연애고민', '남자친구', '여자친구', '썸', '재회', '이별', '연애상담', '소개팅'],
  운세: ['사주풀이', '운세', '신년운세', '사주', '타로', '꿈해몽', '궁합', '자미두수', '명리학'],
  직업: ['이직고민', '취업준비', '직장생활', '퇴직', '사업고민', '부업', '재테크'],
  일상: ['30대일상', '육아고민', '결혼준비', '임신', '부부생활', '자녀교육'],
};

export function getSeasonKeywords(): string[] {
  const month = new Date().getMonth() + 1;
  const seasonMap: Record<number, string[]> = {
    1: ['신년운세', '새해목표', '올해운세'],
    2: ['밸런타인', '연애운', '봄준비'],
    3: ['봄운세', '새출발', '이직시즌'],
    4: ['취업시즌', '봄궁합', '환경변화'],
    5: ['가정의달', '부모운', '결혼운'],
    6: ['여름연애', '휴가계획', '반기운세'],
    7: ['여름운세', '여행운', '건강운'],
    8: ['하반기운세', '가을준비', '취업'],
    9: ['추석운세', '명절궁합', '가을연애'],
    10: ['이직시즌', '연말준비', '취업'],
    11: ['연말운세', '한해결산', '내년준비'],
    12: ['신년준비', '연말운세', '새해인연'],
  };
  return seasonMap[month] ?? [];
}

/** 매 실행마다 풀에서 랜덤 4개 (㊳ 고정 패턴 금지) */
export function selectCrankKeywords(extra: string[] = []): string[] {
  const allKeywords = [
    ...Object.values(CRANK_KEYWORD_POOL).flat(),
    ...getSeasonKeywords(),
    ...extra,
  ];
  const unique = [...new Set(allKeywords.filter(Boolean))];
  return shuffleArray(unique).slice(0, 4);
}
