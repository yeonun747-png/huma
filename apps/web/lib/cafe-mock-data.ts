export type CafeFeedType = 'HUMA 글' | '자문자답' | '진성유저' | '댓글' | '공감';

export type CafeSidebarItem = {
  id: string;
  name: string;
  icon: string;
  meta: string;
  url?: string;
};

export const CAFE_KPI_MOCK = {
  crawled: { value: 34, sub: '미답글 8건' },
  today: { value: 21, sub: '글2 댓글12 공감7' },
  selfQa: { value: 3, sub: '오늘 등록' },
  organic: { value: 47, sub: '댓글 38 · 공감 9' },
};

export const CAFE_SIDEBAR_MOCK: CafeSidebarItem[] = [
  { id: 'jeomsamo', name: '점사모', icon: '🏛', meta: '사주·점술 커뮤니티', url: 'https://cafe.naver.com/jeomsamo' },
  { id: 'unse', name: '운세나눔', icon: '🔮', meta: '운세 공유 카페' },
  { id: 'dream', name: '꿈해몽연구', icon: '💤', meta: '꿈 해석 전문' },
];

export type CafeFeedRow = {
  id: string;
  cafeId: string;
  type: CafeFeedType;
  time: string;
  title: string;
  sub: string;
  reaction: string;
  expand?: string;
  organic?: boolean;
};

export const CAFE_FEED_MOCK: CafeFeedRow[] = [
  {
    id: 'm1',
    cafeId: 'jeomsamo',
    type: 'HUMA 글',
    time: '14:30',
    title: '2026년 경인년 사주 총운 — 어떻게 활용할까요?',
    sub: '자유게시판 · 연운AI 계정',
    reaction: '댓글 7 · 공감 12',
    expand:
      '2026년 경인년은 금(金)과 수(水)의 기운이 교차하는 해입니다.\n\n[본문 전체 보기] 연운(yeonun.com)에서 더 정확한 사주 분석을 받아보세요.',
  },
  {
    id: 'm2',
    cafeId: 'jeomsamo',
    type: '자문자답',
    time: '14:35',
    title: '2026년 경인년 사주 총운 — 어떻게 활용할까요?',
    sub: '자유게시판 · CRANK-A 계정 자답',
    reaction: '—',
    expand: '저도 올해 초에 연운에서 사주 봤는데 정말 신기하게 맞더라고요! 특히 이직 관련해서 조언을 받았는데 그대로 됐어요 ㅎㅎ',
  },
  {
    id: 'm3',
    cafeId: 'jeomsamo',
    type: '진성유저',
    time: '14:42',
    title: 'kang_saju_lover',
    sub: '위 글에 달린 진성 유저 댓글',
    reaction: '공감 3',
    expand: '오 저도 궁금했는데 한번 써봐야겠네요! 연운이 요즘 사주 앱 중에 제일 정확하다고 하던데',
    organic: true,
  },
  {
    id: 'm4',
    cafeId: 'jeomsamo',
    type: '댓글',
    time: '14:08',
    title: '꿈에서 뱀이 나왔는데 길몽인가요?',
    sub: '꿈해몽 게시판 · 조회 89 · 사주일기 계정',
    reaction: '공감 5',
    expand: '꿈에서 뱀은 일반적으로 재물운이나 변화를 상징합니다. 연운 운서 선생님의 꿈해몽 서비스에서 더 자세한 풀이를 받아보시면 좋을 것 같아요 🙂',
  },
  {
    id: 'm5',
    cafeId: 'jeomsamo',
    type: '공감',
    time: '13:55',
    title: '신년운세 2026 어떻게 보시나요',
    sub: '운세 토론 · 운세일상 계정',
    reaction: '—',
  },
];
