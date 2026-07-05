import type { VideoContiCharacter } from './types.js';

/** LLM·EvoLink 공통 — 연예인급 외형 (실명·유명인 모방 금지) */
export const VIDEO_CHARACTER_APPEARANCE_RULE = `등장인물 외형(필수):
- 매번 새로 창작한 인물. 서비스 캐릭터·실제 연예인·유명인 실명·초상 모방 금지.
- 남성: 연예인급 훈남 — 뚜렷한 이목구비, 깊은 눈, 각진 턱선, 깨끗한 피부, 잘생긴 실사 얼굴.
- 여성: 연예인급 훈녀 — 작은 얼굴, 큰 눈, 도자기 피부, 또렷한 이목구비, 아름답고 예쁜 실사 얼굴.
- characters[].face에 위 톤으로 구체적 얼굴 묘사(30~60자). 평범·무난·일반인 느낌 금지.`;

export const VIDEO_CHARACTER_JSON_FACE_EXAMPLE =
  '"face":"연예인급 훈녀, 작은 얼굴·큰 눈·도자기 피부·또렷한 이목구비"';

export const VIDEO_CHARACTER_JSON_SCHEMA_SNIPPET = `{"label":"A","name":"하은","age":"20대","gender":"여","face":"연예인급 훈녀, ...","hair":"...","outfit":"...","shoes":"..."}`;

/** EvoLink/Kling 영상 프롬프트 — 실사·연예인급 얼굴 강조 */
export const EVOLINK_ATTRACTIVE_FACE_SCENE_SUFFIX =
  '시네마틱 실사, 연예인급 훈남·훈녀, photorealistic attractive Korean faces';

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

export function resolveCharacterFaceDescription(character: VideoContiCharacter): string {
  const face = trimField(character.face);
  if (face) return face;

  const gender = trimField(character.gender);
  if (gender.includes('남')) {
    return '연예인급 훈남, 각진 턱선·뚜렷한 이목구비·깊은 눈·깨끗한 피부';
  }
  if (gender.includes('여')) {
    return '연예인급 훈녀, 작은 얼굴·큰 눈·도자기 피부·또렷한 이목구비';
  }
  return '연예인급 훈남·훈녀, photorealistic attractive Korean face';
}

export function buildVideoCharacterAppearancePromptBlock(options?: {
  /** yeonun/quizoasis — 서비스 캐릭터 비등장 */
  banServiceCharacters?: boolean;
  /** panana 고정 캐릭터와 함께 등장하는 상대 역 */
  coStarAttractive?: boolean;
}): string {
  const lines = [`\n${VIDEO_CHARACTER_APPEARANCE_RULE}\n`];
  if (options?.banServiceCharacters) {
    lines.push('서비스 캐릭터(연화/별하/여연/운서 등) 비등장.\n');
  }
  if (options?.coStarAttractive) {
    lines.push('파나나 캐릭터와 대화·대립하는 상대 인물도 연예인급 훈남·훈녀 외형으로 창작.\n');
  }
  return lines.join('');
}
