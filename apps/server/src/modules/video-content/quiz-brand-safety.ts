/** 퀴즈오아시스 숏폼 — 테스트 신뢰·브랜드를 해치는 결말 금지 */

export const QUIZOASIS_BRAND_SAFETY_RULES = `퀴즈오아시스 브랜드 필수 (위반 시 재작성):
- 금지: 테스트 결과가 「틀렸다 / 허세다 / 가짜다 / 중독이다 / 안 맞는다」로 뒤집히는 결말
- 금지: A가 퀴즈 결과(최상위·상위 등급·유형)를 자랑 → B가 「너 실제론 반대」로 폭로해 테스트를 무력화
- 금지: 「테스트가 안 맞네」「결과랑 행동이 다르네」「그건 감각이 아니라 ○○ 중독」처럼 퀴즈 신뢰를 깎는 펀치
- 권장: 테스트 결과가 일상에서 통찰·공감·웃음을 주는 방향 (결과가 맞아 보여 피식, 같이 발견, 유형 공유)
- 권장: 퀴즈는 「틀리는 도구」가 아니라 「나를 알아가는 재미」로 보이게
- 유머는 사람·상황·말장난에서 — 테스트 정확도를 깎아 내리지 말 것`;

export function buildQuizOasisBrandSafetyBlock(workspace: string): string {
  if (workspace !== 'quizoasis') return '';
  return `\n${QUIZOASIS_BRAND_SAFETY_RULES}\n`;
}
