/** Kling 등 영상 생성 모델 — 화면 속 텍스트 렌더링 회피 (페르소나·프롬프트 공통) */
export const VIDEO_SCREEN_TEXT_RENDERING_CONSTRAINT = `- 영상 생성 모델(Kling 등)은 화면 속 텍스트(문서, 메모, 앱 화면 문구, 간판, 표지판 등)를 정확하게 그려내지 못한다.
- 콘티 action에 "화면에 ~라는 글자가 보인다", "문서에 ~라고 적혀 있다"처럼 구체적 문구를 시각적으로 보여주는 지시를 쓰지 않는다.
- 정보는 반드시 등장인물의 대사·표정·반응으로 전달한다.
- 문서·종이·메모·스마트폰 등 텍스트가 있는 사물 자체는 보여줄 수 있으나, 그 안의 구체적 문구는 화면 텍스트로 명시하지 않는다.`;

const CONSTRAINT_MARKER = '화면 속 텍스트';

export function ensureScreenTextRenderingInConstraints(constraints: string): string {
  const trimmed = constraints.trim();
  if (!trimmed) return VIDEO_SCREEN_TEXT_RENDERING_CONSTRAINT;
  if (trimmed.includes(CONSTRAINT_MARKER)) return trimmed;
  return `${trimmed}\n${VIDEO_SCREEN_TEXT_RENDERING_CONSTRAINT}`;
}

export function buildScreenTextRenderingRule(): string {
  return (
    '화면 속 구체적 텍스트(문서·메모·앱·간판 문구)를 action에서 직접 렌더링하려 하지 말고, ' +
    '해당 정보는 dialogue나 표정·반응으로 전달한다. 종이·스마트폰 등 사물 자체는 묘사 가능.'
  );
}

export function buildOnScreenTextFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber}에서 화면 속 텍스트를 직접 보여주려 하고 있다. ` +
    '영상 생성 모델이 텍스트를 정확히 그리지 못하므로, 해당 정보를 인물의 대사나 표정 반응으로 전달하도록 다시 작성하라. ' +
    '문서·종이·스마트폰 등 사물 자체는 보여줄 수 있으나 구체적 문구를 화면에 렌더링하려 하지 말 것.'
  );
}

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

const TEXT_VISIBILITY =
  /(?:글자|문구|글씨|텍스트|제목|내용|단어|문장).{0,24}(?:보인|적혀|쓰여|선명|잡힌|보여|나타|확인|읽히)/u;
const TEXT_VISIBILITY_REV =
  /(?:보인|적혀|쓰여|선명하게?\s*잡힌|선명히|보여|나타).{0,28}(?:글자|문구|글씨|텍스트|제목)/u;
const QUOTED_APPLIED_TO_SURFACE =
  /["'「『""'']([^"'」』""'']{3,})["'」』""''].{0,20}(?:라는|이라는|이라고|라고).{0,8}(?:적혀|쓰여|보인|표시)/u;
const SURFACE_THEN_QUOTED_APPLIED =
  /(?:화면|문서|종이|메모|간판|표지(?:판)?|스마트폰|휴대폰|폰\s*화면|앱\s*화면|지면|전면|확인서|증명서).{0,12}["'「『""''][^"'」』""'']{2,}["'」』""''].{0,12}(?:라고|이라고|라는|이라는).{0,8}(?:적혀|쓰여|보인|표시)/u;
const QUOTED_BEFORE_SURFACE =
  /["'「『""''][^"'」』""'']{3,}["'」』""''].{0,28}(?:화면|문서|종이|메모|간판|표지|스마트폰|앱\s*화면).{0,20}(?:보인|적혀|쓰여|선명|잡힌|보여|나타|글자|문구)/u;

/** action 필드 — 화면 텍스트 직접 렌더링 묘사 여부 */
export function actionDescribesOnScreenText(action: string | undefined | null): boolean {
  const text = trimField(action);
  if (!text) return false;

  if (TEXT_VISIBILITY.test(text) || TEXT_VISIBILITY_REV.test(text)) return true;
  if (QUOTED_APPLIED_TO_SURFACE.test(text)) return true;
  if (SURFACE_THEN_QUOTED_APPLIED.test(text)) return true;
  if (QUOTED_BEFORE_SURFACE.test(text)) return true;

  return false;
}
