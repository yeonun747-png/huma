export type CrankActType = '방문' | '공감' | '댓글' | '이웃';

export type CrankFeedItem = {
  id: string;
  acct: string;
  /** 필터·data-acct (CRANK-A 등) */
  acctKey?: string;
  acctId?: string;
  type: CrankActType;
  title: string;
  sub: string;
  time: string;
  expand?: string;
};

export const CRANK_KPI_MOCK = {
  visit: { current: 143, max: 200 },
  like: { current: 89, max: 150 },
  comment: { current: 31, max: 50 },
  neighbor: { current: 12, max: 20 },
};

export const CRANK_ACCOUNT_CARDS = [
  { id: 'all', label: '전체', count: 275, sub: '10계정' },
  { id: 'CRANK-A', label: 'CRANK-A', count: 38, sub: '서울IP' },
  { id: 'CRANK-B', label: 'CRANK-B', count: 41, sub: '부산IP' },
  { id: 'CRANK-C', label: 'CRANK-C', count: 29, sub: '인천IP' },
  { id: 'CRANK-D', label: 'CRANK-D', count: 44, sub: '대전IP' },
  { id: 'CRANK-E', label: 'CRANK-E', count: 22, sub: '대구IP' },
  { id: 'CRANK-F', label: 'CRANK-F', count: 31, sub: '광주IP' },
  { id: 'CRANK-G', label: 'CRANK-G', count: 27, sub: '울산IP' },
  { id: 'CRANK-H', label: 'CRANK-H', count: 19, sub: '수원IP' },
  { id: 'CRANK-I', label: 'CRANK-I', count: 24, sub: '성남IP' },
  { id: 'CRANK-J', label: 'CRANK-J', count: 22, sub: '고양IP' },
];

export const CRANK_FEED_MOCK: CrankFeedItem[] = [
  {
    id: '1',
    acct: 'CRANK-A',
    type: '댓글',
    title: '2026년 연애운 총정리 — nahan_saju 블로그',
    sub: 'CRANK-A · 14:23 · nahan_saju.blog.me',
    time: '14:23',
    expand: '오 진짜요?ㅋㅋ 저도 요즘 뭔가 연애가 잘 안풀리는 것 같았는데 연운 한번 써봐야겠다 ㅎㅎ',
  },
  {
    id: '2',
    acct: 'CRANK-B',
    type: '공감',
    title: '이직할 때 꼭 봐야 할 사주 — career_saju 블로그',
    sub: 'CRANK-B · 14:18 · career_saju.tistory.com',
    time: '14:18',
  },
  {
    id: '3',
    acct: 'CRANK-C',
    type: '방문',
    title: '토정비결로 보는 올해 운세 — tojung_blog',
    sub: 'CRANK-C · 14:12 · 2분 15초 체류',
    time: '14:12',
  },
  {
    id: '4',
    acct: 'CRANK-A',
    type: '이웃',
    title: '사주명리 연구소 — saju_lab 블로그',
    sub: 'CRANK-A · 14:05 · 이웃신청 완료',
    time: '14:05',
  },
  {
    id: '5',
    acct: 'CRANK-D',
    type: '댓글',
    title: 'MBTI와 사주의 공통점 — mbti_saju 블로그',
    sub: 'CRANK-D · 13:51 · blog.naver.com/mbti_saju',
    time: '13:51',
    expand: '맞아요ㅎㅎ 저 mbti랑 사주 둘다 봤는데 비슷하게 나오더라고요 신기 ㅋㅋ 퀴즈오아시스에도 재밌는 테스트 많으니까 한번 해보세요~',
  },
];
