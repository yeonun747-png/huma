/** 퀴즈오아시스 숏폼 — 테스트 신뢰·브랜드를 해치는 결말 금지 (필수 규약) */

export const QUIZOASIS_BRAND_SAFETY_RULES = `퀴즈오아시스 브랜드 필수 규약 (권고 아님 — 위반 아이디어·콘티는 무효):
- 필수: 테스트 결과가 「맞아서」 피식·공감·자기발견으로 끝나는 결말만 작성
- 필수: 퀴즈는 「나를 알아가는 재미」로만 다룰 것
- 절대 금지: 「테스트 결과 자랑 → 상대가 증거(일정표·쓰레기·자료) 펼침 → 결과랑 안 맞아 무너짐」
- 절대 금지: 결과가 「틀렸다 / 허세다 / 가짜다 / 중독이다 / 안 맞는다 / 틀 안에서만」으로 뒤집힘
- 절대 금지: A가 퀴즈 결과(유형·등급)를 자랑 → B가 「너 실제론 반대」로 폭로해 테스트를 무력화
- 절대 금지: 「나트륨으로 정화」「그 틀이 N개월째」「색감 반복 중독」처럼 퀴즈·유형 조롱
- 절대 금지: 폰을 뒤집어 엎으며 「테스트가 틀렸다」는 뉘앙스로 끝나는 엔딩
- 유머는 사람·상황·말장난에서만 — 테스트 정확도를 깎는 펀치는 출력하지 말 것`;

/** 1단계 첫 발산 방향 고정용 예시 */
export const QUIZOASIS_SAFE_IDEA_EXAMPLES = `필수 형식 예시 (이 방향만 출력):
1) 정리왕 유형 결과를 본 뒤 서랍 라벨을 발견하자 친구가 「아 그래서 네 폴더가 저렇게 예뻤구나」 — 결과가 맞아 피식
2) 둘 다 같은 연애유형이 나와 카페에서 같은 주문을 외쳐 웃는다 — 유형 공감
3) 「즉흥형」 결과를 보고 오늘 일정 없는 빈 캘린더를 보여주며 「맞네」 — 결과 긍정
출력 금지 예시:
X) 창의형 자랑 → 동일 포맷 자료 펼침 → 「틀 안에서만」·폰 엎고 무너짐
X) 치유형 자랑 → 컵라면 펼침 → 「나트륨 정화냐」·폰 엎고 무너짐`;

export const QUIZOASIS_BRAND_WARNING =
  '퀴즈오아시스 브랜드: 테스트 결과가 틀렸다/허세 폭로로 보일 수 있음 — 검토 권장';

export function buildQuizOasisBrandSafetyBlock(workspace: string): string {
  if (workspace !== 'quizoasis') return '';
  return `\n${QUIZOASIS_BRAND_SAFETY_RULES}\n\n${QUIZOASIS_SAFE_IDEA_EXAMPLES}\n`;
}

const QUIZ_MENTION_RE = /퀴즈오아시스|테스트|유형|우뇌|좌뇌|결과|나왔[어어요]|받았/;
const BRAG_RE = /자랑|보여주|내밀|자신만만|역시|창의형|감각적|즉흥|치유|명상형|최상위/;
const EXPOSE_EVIDENCE_RE =
  /펼쳐|꺼내|늘어놓|늘어뜨|드러나|쓰레기|바인더|일정표|출력본|컵라면|용기|자료|동일|같은 요일|고정|반복|전부 같/;
const COLLAPSE_OR_DUNK_RE =
  /무너|엎|궤변|안 맞|틀렸|허세|중독|정화한 거|틀 안|안 바뀌|조롱|폭로|실제론|반대/;

/** 「결과 자랑 → 증거 폭로 → 결과 안 맞음/무너짐」 템플릿 감지 (로컬, 토큰 0). */
export function isQuizOasisBrandViolation(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;

  const hasQuiz = QUIZ_MENTION_RE.test(t);
  const hasBrag = BRAG_RE.test(t);
  const hasExpose = EXPOSE_EVIDENCE_RE.test(t);
  const hasDunk = COLLAPSE_OR_DUNK_RE.test(t);

  if (hasQuiz && hasBrag && hasExpose && hasDunk) return true;
  if (hasQuiz && hasExpose && hasDunk && (hasBrag || /유형|결과|테스트/.test(t))) return true;
  if (hasQuiz && /중독이네|안 맞|틀렸|테스트가 틀|결과랑 다르/.test(t)) return true;

  return false;
}

export function filterQuizOasisSafeIdeas(ideas: string[]): string[] {
  return ideas.filter((idea) => !isQuizOasisBrandViolation(idea));
}

export function contiTextForBrandCheck(params: {
  scenarioSummary?: string | null;
  punchlineIdea?: string | null;
  dialogues?: Array<string | null | undefined>;
}): string {
  return [
    params.punchlineIdea ?? '',
    params.scenarioSummary ?? '',
    ...(params.dialogues ?? []).map((d) => d ?? ''),
  ]
    .join('\n')
    .trim();
}
