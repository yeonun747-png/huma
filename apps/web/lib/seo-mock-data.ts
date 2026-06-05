import type { Workspace } from '@huma/shared';

export type SeoRankRow = { rank: string; word: string; vol: string; chg: string; ok: boolean | null };
export type SeoMapRow = { id: string; kw: string; cnt: number; reflect: string; st: string; tone: 'ok' | 'warn' | 'err' };

export const SEO_WORKSPACE_URL: Record<Workspace, string> = {
  yeonun: 'https://yeonun.com',
  quizoasis: 'https://myquizoasis.com',
  panana: 'https://panana.kr',
};

export const SEO_DATA: Record<
  Workspace,
  { badge: string; ranks: SeoRankRow[]; pool: string[]; table: SeoMapRow[] }
> = {
  yeonun: {
    badge: '연운 워크스페이스',
    ranks: [
      { rank: '#2', word: '사주풀이', vol: '3,420/일', chg: '▲1', ok: true },
      { rank: '#4', word: '신년운세 2026', vol: '2,890/일', chg: '▲3', ok: true },
      { rank: '#7', word: '꿈해몽', vol: '2,140/일', chg: '▼2', ok: false },
      { rank: '#11', word: '자미두수', vol: '1,230/일', chg: '신규', ok: null },
      { rank: '#15', word: '사주 궁합', vol: '980/일', chg: '—', ok: null },
    ],
    pool: [
      '사주풀이', '신년운세', '꿈해몽', '자미두수', '사주 궁합', '오늘 운세', '사주명리',
      '사주 보는법', '무료 사주', '타로 운세', '재회 사주', '직업 사주', '이직 사주', '연애운', '재물운',
    ],
    table: [
      { id: 'dream-lastnight', kw: '꿈해몽, 꿈의미', cnt: 24, reflect: '포스팅 3건 → 순위 #7', st: '최상', tone: 'ok' },
      { id: 'reunion-maybe', kw: '재회사주, 재회가능성', cnt: 12, reflect: '포스팅 2건 → 인덱싱', st: '양호', tone: 'ok' },
      { id: 'career-timing', kw: '이직사주, 승진운', cnt: 8, reflect: '포스팅 1건 → 반영중', st: '보강필요', tone: 'warn' },
      { id: 'zimi-chart', kw: '자미두수풀이', cnt: 5, reflect: '신규 → 인덱싱 대기', st: '부족', tone: 'err' },
    ],
  },
  quizoasis: {
    badge: '퀴즈오아시스 워크스페이스',
    ranks: [
      { rank: '#3', word: 'MBTI 테스트', vol: '1,240 클릭', chg: '▲2', ok: true },
      { rank: '#5', word: '성격 유형 테스트', vol: '1,103 클릭', chg: '▲3', ok: true },
      { rank: '#7', word: '연애유형 테스트', vol: '892 클릭', chg: '▲5', ok: true },
      { rank: '#12', word: '직업 적성 검사', vol: '634 클릭', chg: '▼1', ok: false },
      { rank: '#18', word: '심리 테스트', vol: '412 클릭', chg: '▲1', ok: true },
    ],
    pool: [
      'MBTI 테스트', '성격유형 테스트', '연애유형', '직업적성', '심리테스트', '애착유형', '성격분석',
      '16가지유형', 'personality test', 'mbti quiz', 'love type test', '성격 검사',
    ],
    table: [
      { id: 'mbti-test', kw: 'MBTI 테스트, 16유형', cnt: 38, reflect: '포스팅 5건 → 순위 #3', st: '최상', tone: 'ok' },
      { id: 'attachment-type', kw: '애착유형, attachment style', cnt: 21, reflect: '포스팅 3건 → 순위 #7', st: '양호', tone: 'ok' },
      { id: 'career-aptitude', kw: '직업적성, career test', cnt: 14, reflect: '포스팅 2건 → 반영중', st: '보강필요', tone: 'warn' },
      { id: 'love-conflict', kw: '연애갈등, 연애 MBTI', cnt: 9, reflect: '신규 → 인덱싱 대기', st: '부족', tone: 'err' },
    ],
  },
  panana: {
    badge: '파나나 워크스페이스',
    ranks: [
      { rank: '#4', word: 'AI 캐릭터 채팅', vol: '890 클릭', chg: '▲6', ok: true },
      { rank: '#8', word: 'AI 친구 앱', vol: '612 클릭', chg: '▲2', ok: true },
      { rank: '#14', word: '감성 AI 대화', vol: '421 클릭', chg: '—', ok: null },
      { rank: '#21', word: 'AI 연애 챗봇', vol: '287 클릭', chg: '신규', ok: true },
    ],
    pool: [
      'AI 캐릭터', 'AI 친구', '감성 AI', 'AI 대화', '챗봇 앱', 'AI 연애',
      'character AI', 'AI companion', '파나나', 'panana app', 'AI 소통', '감성 채팅',
    ],
    table: [
      { id: 'ai-character-chat', kw: 'AI 캐릭터 채팅, AI친구', cnt: 18, reflect: '포스팅 3건 → 순위 #4', st: '양호', tone: 'ok' },
      { id: 'ai-emotional', kw: '감성 AI, AI 대화앱', cnt: 9, reflect: '포스팅 1건 → 인덱싱중', st: '보강필요', tone: 'warn' },
    ],
  },
};
