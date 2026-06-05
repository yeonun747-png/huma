/** 발행 모니터 — API job 카드 위에 덧씌우는 정적 mock */

export const MONITOR_MOCK_LIVE = [
  {
    account: '운세일상',
    platform: '네이버',
    wpm: 61,
    chars: 847,
    totalChars: 1623,
    typos: 3,
    eta: '14:38',
    preview: '이직 타이밍, 사주로 알아보기\n\n많은 분들이 이직을 고민할 때 가장 많이 하시는 질문이 "지금이 맞는 타이밍인가요?" 사주명리학에서는 이직의 타이밍을 매우 중요하게 봅니다. 특히 2026년 병오(丙午)년은 화기',
  },
  {
    account: '심테연구소',
    platform: '티스토리',
    wpm: 57,
    chars: 1240,
    totalChars: 2800,
    typos: 5,
    eta: '14:52',
    preview: 'MBTI 16가지 유형 완전 정리 가이드\n\nMBTI는 Myers-Briggs Type Indicator의 약자로, 사람의 성격을 16가지 유형으로 분류하는 심리 검사입니다. 오늘은 각 유형의 특징과 적합한 직업을',
  },
];

export const MONITOR_MOCK_IDLE = {
  account: '사주일기',
  schedule: '15:30 예약',
  title: '궁합 체크리스트 — 연화',
};

export const MONITOR_MOCK_ERR = {
  account: '@panana_sora',
  platform: 'TikTok',
  detail: '세션 만료 → 자동 중지',
  sub: '10:45 발생 · 재연결 필요',
};
