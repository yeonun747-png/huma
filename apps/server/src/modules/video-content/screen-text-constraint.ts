/** Kling 등 영상 생성 모델 — 화면 속 텍스트·읽어야 하는 라벨 렌더링 회피 */
export const VIDEO_SCREEN_TEXT_RENDERING_CONSTRAINT = `- 영상 생성 모델(Kling 등)은 화면 속 텍스트(문서, 메모, 앱 화면, 간판, 표지판, 명찰, 스티커, 라벨 등)를 정확하게 그려내지 못한다.
- "특정 정보를 읽어야만 의미가 통하는" 시각 요소(이름, 직함, 스티커 문구, 표지판 글자 등)도 화면 텍스트와 동일하게 취급한다. action에 "이름이 적힌 스티커", "명찰 글자가 보인다"처럼 구체적 내용을 시각적으로 보여주지 않는다.
- 그런 정보가 필요하면 반드시 등장인물 대사로 풀어 쓴다 (예: "어? 이거 내 슬리퍼 아닌데, 민지 거잖아").
- 문서·종이·스마트폰·스티커·명찰 등 사물 자체는 보여줄 수 있으나, 그 안의 구체적 문구·이름·라벨 내용은 action에서 렌더링하려 하지 않는다.`;

const CONSTRAINT_MARKER = '화면 속 텍스트';

export function ensureScreenTextRenderingInConstraints(constraints: string): string {
  const trimmed = constraints.trim();
  if (!trimmed) return VIDEO_SCREEN_TEXT_RENDERING_CONSTRAINT;
  if (trimmed.includes(CONSTRAINT_MARKER)) return trimmed;
  return `${trimmed}\n${VIDEO_SCREEN_TEXT_RENDERING_CONSTRAINT}`;
}

export function buildScreenTextRenderingRule(): string {
  return (
    '화면 속 구체적 텍스트·이름·라벨·스티커·명찰·간판 문구를 action에서 직접 렌더링하려 하지 말고, ' +
    '해당 정보는 dialogue로 풀어서 전달한다. 사물 자체(종이·스마트폰·슬리퍼·명찰 등)는 묘사 가능.'
  );
}

export function buildOnScreenTextFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber}에서 화면 속 텍스트·이름·라벨·스티커 등 "읽어야 의미가 통하는" 정보를 직접 보여주려 하고 있다. ` +
    '영상 생성 모델이 글자·이름·라벨을 정확히 그리지 못하므로, 해당 정보를 인물 대사로 풀어서 전달하도록 action을 다시 작성하라. ' +
    '예: "어? 이 슬리퍼 내 거 아닌데, ○○ 거잖아"처럼 dialogue로 반전을 설명한다.'
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
  /["'「『""''][^"'」』""'']{3,}["'」』""''].{0,28}((?:화면|문서|종이|메모|간판|표지|스마트폰|앱\s*화면)).{0,20}(?:보인|적혀|쓰여|선명|잡힌|보여|나타|글자|문구)/u;
const READABLE_NAME_OR_LABEL =
  /(?:이름|명칭|직함|호칭|글자|문구).{0,12}(?:적혀|쓰여|새겨|인쇄|표시|붙)/u;
const LABELED_OBJECT =
  /(?:스티커|명찰|라벨|딱지|표지(?:판)?|간판|영수증|택|배지).{0,28}(?:적혀|쓰여|새겨|인쇄|붙|표시)/u;
const OBJECT_WITH_READABLE_NAME =
  /(?:스티커|명찰|라벨|슬리퍼|바닥|유니폼|옷|소매|가방).{0,36}(?:이름|다른\s*\S+\s*이름).{0,12}(?:적혀|쓰여|붙|새겨)/u;
const READ_TO_UNDERSTAND =
  /(?:읽어야|읽으면|글자를\s*읽|이름을\s*읽|적혀\s*있(?:는|고|어)|쓰여\s*있(?:는|고|어)).{0,32}(?:스티커|명찰|라벨|표지|간판|슬리퍼|바닥|유니폼)/u;

/** action 필드 — 읽어야 의미가 통하는 화면 텍스트·라벨 직접 렌더링 여부 */
export function actionDescribesOnScreenText(action: string | undefined | null): boolean {
  const text = trimField(action);
  if (!text) return false;

  if (TEXT_VISIBILITY.test(text) || TEXT_VISIBILITY_REV.test(text)) return true;
  if (QUOTED_APPLIED_TO_SURFACE.test(text)) return true;
  if (SURFACE_THEN_QUOTED_APPLIED.test(text)) return true;
  if (QUOTED_BEFORE_SURFACE.test(text)) return true;
  if (READABLE_NAME_OR_LABEL.test(text)) return true;
  if (LABELED_OBJECT.test(text)) return true;
  if (OBJECT_WITH_READABLE_NAME.test(text)) return true;
  if (READ_TO_UNDERSTAND.test(text)) return true;

  return false;
}
