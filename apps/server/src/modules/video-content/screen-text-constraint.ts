/** Kling 등 영상 생성 모델 — 화면 속 텍스트·읽어야 하는 라벨 렌더링 회피 */
export const VIDEO_SCREEN_TEXT_RENDERING_CONSTRAINT = `- 영상 생성 모델(Kling 등)은 화면 속 텍스트(문서, 메모, 앱 화면, 간판, 표지판, 명찰, 스티커, 라벨 등)를 정확하게 그려내지 못한다.
- "특정 정보를 읽어야만 의미가 통하는" 시각 요소(이름, 직함, 스티커 문구, 표지판 글자, 스탬프·날짜·취소 통보, 연운·운세 앱 문구 등)도 화면 텍스트와 동일하게 취급한다. action에 "이름이 적힌 스티커", "명찰 글자가 보인다", "특정 문구에서 손가락을 멈춘다"처럼 구체적 내용을 시각적으로 보여주지 않는다.
- "○○이 보이도록 각도를 잡는다", "문서 상단 스탬프가 선명하게 잡힌다"처럼 카메라 각도·구도로 읽히게 하려는 우회 표현도 금지한다.
- 연운·운세·앱에서 읽는 setup 문구(예: "윗집과 소음 갈등 주의")는 action·scenarioSummary에만 두지 말고, 해당 샷 dialogue에 전문을 말로 넣는다. action은 "폰을 스크롤하며 웃는다" 정도만.
- 예 dialogue: A: "윗집과 소음 갈등 주의라고? 웃기네, 빈 집인데." (반응만 "빈 집인데"로 두면 안 됨)
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
    '화면 속 구체적 텍스트·이름·라벨·스티커·명찰·간판·스탬프·날짜·연운·운세 앱 문구를 action에서 직접 렌더링하려 하지 말고, ' +
    '"특정 문구에서 멈춘다", "보이도록 각도를 잡음", "상단 스탬프가 선명하게 잡힘" 같은 우회 표현도 금지한다. ' +
    '읽어야 setup이 통하는 정보는 dialogue에 전문을 말로 넣는다(예: A: "윗집과 소음 갈등 주의라고? 웃기네, 빈 집인데."). ' +
    'action은 폰·종이 등 사물과 표정·동작만 묘사한다.'
  );
}

/** 연운 — 운세 setup을 dialogue로 강제 (3a·3b 프롬프트용) */
export function buildYeonunFortuneDialogueRule(): string {
  return (
    '연운·운세 setup (Kling 한글 렌더 불가 — 필수):\n' +
    '- 앱/폰에서 읽는 운세·경고 문구는 narrativeProse·action이 아니라 **dialogue**에 넣는다.\n' +
    '- 경고 문구 **전문**은 전체 샷 중 **최초 setup 샷 1곳에만** 넣는다. 두 번째 화자 반응 샷은 "똑같은 경고 봤어요"처럼 **짧게 참조**하고 전문을 반복하지 않는다.\n' +
    '- 각 샷 dialogue는 해당 샷 초×8자(공백 제외) 예산을 반드시 지킨다.\n' +
    '- action 금지: "특정 문구에서 손가락을 멈춘다", "화면 글자가 보인다". action 허용: "스마트폰을 스크롤하며 코웃음 친다" 등 동작만.\n' +
    '- dialogue 예: A: "협력자 신뢰 문제 주의래요. 모래 위 집이라던데요." (❌ B가 같은 문구 전문을 다시 읽음)'
  );
}

export function buildFortuneSetupDialogueFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber}에서 연운·운세·앱 setup 정보가 action·scenarioSummary에만 있고 dialogue에 없거나, ` +
    '대사가 "빈 집인데"처럼 반응만 있고 읽은 문구 전문이 빠져 있다. ' +
    'Kling은 화면 한글·"특정 문구"를 그리지 못하므로, 읽은 운세·경고 문구 **전체**를 dialogue에 넣어라. ' +
    '예: A: "윗집과 소음 갈등 주의라고? 웃기네, 빈 집인데." — action은 폰 스크롤·표정만.'
  );
}

export function buildOnScreenTextFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber}에서 화면 속 텍스트·이름·라벨·스티커·스탬프·날짜 등 "읽어야 의미가 통하는" 정보를 직접 보여주려 하고 있다. ` +
    '"보이도록 각도를 잡음" 같은 우회 표현도 동일하게 금지된다. ' +
    '영상 생성 모델이 글자·이름·라벨을 정확히 그리지 못하므로, 해당 정보를 인물 대사로 풀어서 전달하도록 action을 다시 작성하라. ' +
    '예: "어? 이 슬리퍼 내 거 아닌데, ○○ 거잖아", "어젯밤에 취소 팩스 왔어요"처럼 dialogue로 반전을 설명한다.'
  );
}

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

const TEXT_VISIBILITY =
  /(?:글자|문구|글씨|텍스트|제목|내용|단어|문장|페이지|결과).{0,24}(?:보인|적혀|적힌|쓰여|선명|잡힌|보여|나타|확인|읽히|노출)/u;
const TEXT_VISIBILITY_REV =
  /(?:보인|적혀|적힌|쓰여|선명하게?\s*잡힌|선명히|보여|나타|노출).{0,28}(?:글자|문구|글씨|텍스트|제목|페이지|결과)/u;
const APP_OR_RESULT_PAGE =
  /(?:앱|사주|운세).{0,12}(?:결과\s*페이지|화면|페이지).{0,16}(?:보|노출|켜|표시)/u;
const QUOTED_APPLIED_TO_SURFACE =
  /["'「『""'']([^"'」』""'']{3,})["'」』""''].{0,20}(?:라는|이라는|이라고|라고).{0,8}(?:적혀|쓰여|보인|표시)/u;
const SURFACE_THEN_QUOTED_APPLIED =
  /(?:화면|문서|종이|메모|간판|표지(?:판)?|스마트폰|휴대폰|폰\s*화면|앱\s*화면|지면|전면|확인서|증명서).{0,12}["'「『""''][^"'」』""'']{2,}["'」』""''].{0,12}(?:라고|이라고|라는|이라는).{0,8}(?:적혀|쓰여|보인|표시)/u;
const QUOTED_BEFORE_SURFACE =
  /["'「『""''][^"'」』""'']{3,}["'」』""''].{0,28}((?:화면|문서|종이|메모|간판|표지|스마트폰|앱\s*화면)).{0,20}(?:보인|적혀|쓰여|선명|잡힌|보여|나타|글자|문구)/u;
const READABLE_NAME_OR_LABEL =
  /(?:이름|명칭|직함|호칭|글자|문구).{0,12}(?:적혀|적힌|쓰여|새겨|인쇄|표시|붙)/u;
const LABELED_OBJECT =
  /(?:스티커|명찰|라벨|딱지|표지(?:판)?|간판|영수증|택|배지).{0,28}(?:적혀|쓰여|새겨|인쇄|붙|표시)/u;
const OBJECT_WITH_READABLE_NAME =
  /(?:스티커|명찰|라벨|슬리퍼|바닥|유니폼|옷|소매|가방).{0,36}(?:이름|다른\s*\S+\s*이름).{0,12}(?:적혀|쓰여|붙|새겨)/u;
const READ_TO_UNDERSTAND =
  /(?:읽어야|읽으면|글자를\s*읽|이름을\s*읽|적혀\s*있(?:는|고|어)|쓰여\s*있(?:는|고|어)).{0,32}(?:스티커|명찰|라벨|표지|간판|슬리퍼|바닥|유니폼)/u;
/** 카메라 각도·구도로 읽히게 하려는 우회 (예: "보이도록 각도를 잡음") */
const FRAMING_FOR_READABLE_DETAIL =
  /(?:보이(?:도록|게)|드러나(?:도록|게)|선명(?:하게?)?(?:\s*잡)?|잡히(?:도록|게)).{0,20}각도/u;
const ANGLE_TO_SHOW_READABLE_DETAIL =
  /각도(?:를)?\s*잡(?:아|음).{0,28}(?:보이|드러|선명|스탬프|날짜|글자|문구|확인|통보|취소|내용|스탬프)/u;
const READABLE_DETAIL_THEN_VISIBILITY =
  /(?:스탬프|도장|날짜|확인(?:서|증)?|통보|취소|내용|상단|하단|모서리|끝).{0,24}(?:보이(?:도록|게)|드러|선명|잡|노출)/u;
const DOCUMENT_PART_VISIBILITY =
  /(?:문서|종이|서류|팩스|확인(?:서|증)?).{0,16}(?:상단|하단|모서리|끝|표면).{0,20}(?:보이|잡|드러|노출)/u;
const VAGUE_READABLE_TEXT_REFERENCE = /(?:특정|해당|그|어떤|이)\s*문구/u;
const SCROLL_STOP_AT_VAGUE_TEXT =
  /(?:스크롤|내려|넘기).{0,40}(?:특정|해당|그|어떤|이).{0,8}문구/u;
const FINGER_STOP_AT_VAGUE_TEXT =
  /(?:손가락|손).{0,20}(?:멈|정지).{0,28}(?:문구|글|텍스트)/u;
const PHONE_SCROLL_READ_SETUP =
  /(?:스마트폰|휴대폰|폰(?:\s*화면)?).{0,64}(?:스크롤|내려|넘기).{0,64}(?:멈|정지|손가락|문구|글|텍스트)/u;
const PHONE_FORTUNE_READ_ACTION =
  /(?:스마트폰|휴대폰|폰(?:\s*화면)?).{0,48}(?:스크롤|내려|넘기|확인).{0,32}(?:연운|운세|앱)/u;
const YEONUN_FORTUNE_READ_ACTION =
  /(?:연운|운세(?:\s*앱)?).{0,48}(?:보|확인|스크롤|읽|내려)/u;

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
  if (APP_OR_RESULT_PAGE.test(text)) return true;
  if (FRAMING_FOR_READABLE_DETAIL.test(text)) return true;
  if (ANGLE_TO_SHOW_READABLE_DETAIL.test(text)) return true;
  if (READABLE_DETAIL_THEN_VISIBILITY.test(text)) return true;
  if (DOCUMENT_PART_VISIBILITY.test(text)) return true;
  if (VAGUE_READABLE_TEXT_REFERENCE.test(text)) return true;
  if (SCROLL_STOP_AT_VAGUE_TEXT.test(text)) return true;
  if (FINGER_STOP_AT_VAGUE_TEXT.test(text)) return true;

  return false;
}

/** 폰·연운 앱에서 setup을 읽는 샷 — dialogue에 읽은 내용이 있어야 함 */
export function actionUsesPhoneOrFortuneReadableSetup(action: string | undefined | null): boolean {
  const text = trimField(action);
  if (!text) return false;
  if (PHONE_SCROLL_READ_SETUP.test(text)) return true;
  if (PHONE_FORTUNE_READ_ACTION.test(text)) return true;
  if (YEONUN_FORTUNE_READ_ACTION.test(text)) return true;
  if (/(?:스마트폰|휴대폰|폰(?:\s*화면)?)/u.test(text) && VAGUE_READABLE_TEXT_REFERENCE.test(text)) return true;
  return false;
}

/** scenarioSummary에 연운·운세 경고 setup이 서술되어 있는지 */
export function scenarioSummaryMentionsFortuneWarning(summary: string | undefined | null): boolean {
  const text = trimField(summary);
  if (!text) return false;
  const hasFortuneContext = /(?:연운|운세|이달\s*운|월\s*운|오늘(?:의)?\s*운)/u.test(text);
  const hasWarningPhrase = /(?:주의|경고|갈등|조심|피하|주의하|갈등\s*주의)/u.test(text);
  return hasFortuneContext && hasWarningPhrase;
}

/** 폰·연운 setup 샷 — dialogue에 읽은 문구 전문 필요 */
export function shotNeedsFortuneSetupDialogue(
  action: string | undefined | null,
  scenarioSummary?: string | undefined | null,
): boolean {
  if (actionUsesPhoneOrFortuneReadableSetup(action)) return true;
  const act = trimField(action);
  if (!scenarioSummaryMentionsFortuneWarning(scenarioSummary)) return false;
  if (!/(?:스마트폰|휴대폰|폰(?:\s*화면)?)/u.test(act)) return false;
  return /(?:스크롤|내려|넘기|확인|연운|운세|앱|화면)/u.test(act);
}

function normalizeDialogueBodyForSetup(dialogue: string): string {
  return trimField(dialogue)
    .replace(/^[A-Z]:\s*/i, '')
    .replace(/^["「『]|["」』]$/g, '')
    .trim();
}

/** setup 문구를 dialogue에 전문으로 담았는지 — 반응만("빈 집인데")이면 false */
export function dialogueCarriesReadableSetup(dialogue: string | undefined | null): boolean {
  const body = normalizeDialogueBodyForSetup(dialogue ?? '');
  if (body.length < 12) return false;

  const reactionOnly =
    /^(?:웃기네|헐|어\??|빈\s*집(?:인데|이)?\.?|진짜\??|대박|피식)$/u.test(body) ||
    /^빈\s*집(?:인데|이)?\.?$/u.test(body);
  if (reactionOnly) return false;

  if (/(?:라고|이라고|라며|라니|라네)\??/u.test(body) && body.length >= 14) return true;
  if (body.length >= 22) return true;

  return false;
}
