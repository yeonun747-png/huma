import type { Workspace } from '@huma/shared';

export type DashboardPeriod = 'today' | 'week' | 'month';

export const CHART_DATA: Record<DashboardPeriod, { label: string; values: number[] }> = {
  today: { label: '오늘 기준', values: [18, 22, 19, 24, 21, 25, 24] },
  week: { label: '이번주', values: [120, 132, 118, 145, 138, 152, 142] },
  month: { label: '이번달', values: [89, 124, 156, 183, 201, 218, 0] },
};

export const CHART_LABELS: Record<DashboardPeriod, string[]> = {
  today: ['월', '화', '수', '목', '금', '토', '일'],
  week: ['4/27', '4/28', '4/29', '4/30', '5/1~', '5/8~', '5/15~'],
  month: ['12월', '1월', '2월', '3월', '4월', '5월', '(예상)'],
};

/** 조회수 내림차순 정렬 후 ROAS 바 비례 계산 */
export const ROAS_ITEMS = [
  { title: '위로 영상 · 하루', platform: 'TikTok', views: 12400 },
  { title: '꿈해몽 가이드', platform: '네이버', views: 4821 },
  { title: 'MBTI 테스트', platform: 'Google', views: 3240 },
  { title: '신년운세 리뷰', platform: '네이버', views: 2890 },
  { title: '궁합 체크리스트', platform: '네이버', views: 1932 },
].sort((a, b) => b.views - a.views);

export function roasBarWidth(views: number, maxViews: number): number {
  if (maxViews <= 0) return 0;
  return Math.round((views / maxViews) * 100);
}

export const SERVICE_STATUS: Record<
  Workspace,
  { icon: string; name: string; detail: string; todayJobs: number; jobsLabel: string; status: 'ok' | 'warn' | 'err' }
> = {
  yeonun: {
    icon: '🔮',
    name: '연운 緣運',
    detail: 'LIVE 1 · IDLE 2 · 블로그 3계정',
    todayJobs: 16,
    jobsLabel: '오늘 발행',
    status: 'ok',
  },
  quizoasis: {
    icon: '🧠',
    name: '퀴즈오아시스',
    detail: 'IDLE · 번역 대기 2건',
    todayJobs: 6,
    jobsLabel: '오늘 발행',
    status: 'warn',
  },
  panana: {
    icon: '🎬',
    name: '파나나',
    detail: '⚠ ERR · sora 세션 만료',
    todayJobs: 2,
    jobsLabel: '오류 발생',
    status: 'err',
  },
};

export const PERIOD_INTEGRATED_STATS: Record<
  DashboardPeriod,
  { todayPublish: number; todayPublishSub: string; queuePending: number; queueSub: string; errors: number; errorsSub: string }
> = {
  today: {
    todayPublish: 24,
    todayPublishSub: '▲ +8 어제 대비',
    queuePending: 8,
    queueSub: '다음 15:30',
    errors: 1,
    errorsSub: 'Layer4 감지 1',
  },
  week: {
    todayPublish: 142,
    todayPublishSub: '이번주 누적',
    queuePending: 18,
    queueSub: '주간 스케줄',
    errors: 4,
    errorsSub: '주간 오류 4',
  },
  month: {
    todayPublish: 590,
    todayPublishSub: '이번달 누적',
    queuePending: 72,
    queueSub: '월간 대기',
    errors: 11,
    errorsSub: '월간 오류 11',
  },
};

export const INTEGRATED_STATS = {
  ...PERIOD_INTEGRATED_STATS.today,
  activeAccounts: 7,
  totalAccounts: 8,
  accountSub: '⚠ panana_sora 세션오류 →',
};

export type PostRowStatus = 'done' | 'running' | 'idle' | 'error' | 'warn';

export type PostRow = {
  title: string;
  meta: string;
  status: PostRowStatus;
  statusLabel: string;
  url?: string;
  urlKind?: 'link' | 'generating' | 'dash' | 'watcher';
};

export const YEONUN_POSTS: PostRow[] = [
  { title: '2026 신년운세 리뷰', meta: '별하', status: 'done', statusLabel: '완료', url: 'https://blog.naver.com/saju_diary/12345', urlKind: 'link' },
  { title: '꿈해몽 완전 가이드', meta: '운서', status: 'done', statusLabel: '완료', url: 'https://blog.naver.com/unse_daily/6789', urlKind: 'link' },
  { title: '궁합 체크리스트', meta: '연화', status: 'running', statusLabel: '발행중', urlKind: 'generating' },
  { title: '자미두수 입문 해설', meta: '별하', status: 'idle', statusLabel: '대기', urlKind: 'dash' },
  { title: '사주 상담 후기', meta: '여연', status: 'error', statusLabel: '오류', urlKind: 'watcher' },
];

export const YEONUN_SOCIAL = [
  { label: '🤝 오늘 타 블로그 방문', current: 143, max: 200 },
  { label: '❤ 공감 클릭', current: 89, max: 150 },
  { label: '💬 AI 댓글 게시', current: 31, max: 50 },
  { label: '👥 이웃 신청', current: 12, max: 20 },
  { label: '🏛 카페 소통', current: 8, max: null as number | null },
];

export const QUIZ_STATS = [
  { label: '오늘 수익', value: '$12.4', sub: '▲ $2.1', tone: 'ok' as const },
  { label: '월 누계', value: '$218', sub: '목표 54%' },
  { label: '일 PV', value: '8.2K', sub: '▲ 12%', tone: 'ok' as const },
  { label: 'RPM', value: '$1.51', sub: '↑ $1.34' },
];

export const QUIZ_KEYWORDS = [
  { rank: '#3', word: 'MBTI 테스트', vol: '1,240 클릭', chg: '▲2', ok: true },
  { rank: '#5', word: '성격 유형 테스트', vol: '1,103 클릭', chg: '▲3', ok: true },
  { rank: '#7', word: '연애유형 테스트', vol: '892 클릭', chg: '▲5', ok: true },
  { rank: '#12', word: '직업 적성 검사', vol: '634 클릭', chg: '▼1', ok: false },
];

export const QUIZ_POSTS: PostRow[] = [
  { title: '애착유형 테스트', meta: '7', status: 'done', statusLabel: '완료', url: 'https://instagram.com/', urlKind: 'link' },
  { title: '16유형 직업적성', meta: '7', status: 'done', statusLabel: '완료', url: 'https://x.com/', urlKind: 'link' },
  { title: '연애 갈등 유형', meta: '3', status: 'warn', statusLabel: '번역중', urlKind: 'dash' },
];

export const PANANA_STATS = [
  { label: '총 팔로워', value: '42K', sub: '▲ 1.2K', tone: 'ok' as const },
  { label: '오늘 발행', value: '6', sub: '4채널' },
  { label: '영상 조회', value: '28K', sub: '오늘' },
  { label: '오류 계정', value: '1', sub: 'sora 세션만료', tone: 'err' as const },
];

export const PANANA_POSTS: PostRow[] = [
  { title: '🌸 하루', meta: 'TikTok', status: 'done', statusLabel: '완료', url: 'https://tiktok.com/', urlKind: 'link' },
  { title: '⚡ 레이', meta: 'IG', status: 'running', statusLabel: '업로드중', urlKind: 'generating' },
  { title: '🎵 소라', meta: 'TikTok', status: 'error', statusLabel: '세션오류', urlKind: 'dash' },
  { title: '🌿 민', meta: 'Threads', status: 'done', statusLabel: '완료', url: 'https://threads.net/', urlKind: 'link' },
];

export const PANANA_SOCIAL = [
  { label: '💬 자동 댓글 반응', value: '47건' },
  { label: '📨 DM 자동 발송', value: '12건' },
  { label: '❤ 좋아요 자동', value: '188건' },
  { label: '👥 신규 팔로우 DM', value: '8건' },
];
