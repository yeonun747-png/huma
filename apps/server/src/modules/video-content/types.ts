import type { Workspace } from '@huma/shared';
import { EVOLINK_PROMPT_LENGTH_GUIDANCE } from './prompt-length.js';
import { MULTI_SHOT_TEMPLATE_15S } from './shot-timing.js';

const DEFAULT_CUT_TYPE_RULE = `멀티샷 75% / 싱글샷 25% 비율 유지.
직전 5건 cut_type 회피(0.85 확률 예외).
싱글샷: 4~5 시간 비트 연속 전개, 컷 없음.`;

const DEFAULT_SHOT_STRUCTURE = `${MULTI_SHOT_TEMPLATE_15S}

${EVOLINK_PROMPT_LENGTH_GUIDANCE}`;

export interface VideoPersonaConfig {
  relationshipAxes: string[];
  /** 파나나 — 캐릭터 출연 상황 카테고리 */
  situationAxes?: string[];
  emotionCurves: string[];
  hookTypes: string[];
  /** hook_type → 최대 선택 비율 (0~1). 미설정 시 제한 없음 */
  hookTypeMaxWeight?: Record<string, number>;
  cutTypeRule?: string;
  shotStructure?: string;
  serviceConstraints: string;
  extraPromptNotes?: string;
}

export interface VideoContiShot {
  shotNumber: number;
  startSec: number;
  endSec: number;
  camera: string;
  action: string;
  dialogue?: string;
}

export interface VideoConti {
  characters: Array<{
    label: string;
    /** 등장인물 설정에 명시된 이름 — 본문에서 A/B 대신 사용 시 필수 */
    name?: string;
    age: string;
    gender: string;
    hair: string;
    outfit: string;
    shoes: string;
  }>;
  location: string;
  lighting: string;
  timeOfDay: string;
  cutType: 'single_shot' | 'multi_shot';
  duration: number;
  shots: VideoContiShot[];
  scenarioSummary: string;
  fullText: string;
}

export interface GenerationConditions {
  relationshipAxis: string;
  /** 파나나 등 — situationAxes 가 있을 때만 선택 */
  situationAxis?: string;
  emotionCurve: string;
  hookType: string;
  locationKeyword: string;
  timeOfDay: string;
  cutType: 'single_shot' | 'multi_shot';
  duration: number;
  characterId?: string;
  characterName?: string;
  characterDescription?: string;
}

export interface SubtitleStyle {
  font: string;
  position: string;
  timing: string;
  boxStyle: string;
}

export interface PlatformCaptions {
  captionYoutube: string;
  captionTiktok: string;
  captionInstagram: string;
  captionThreads: string;
  captionX: string;
  firstCommentThreads: string | null;
  firstCommentX: string | null;
}

export const DURATION_OPTIONS = [9, 11, 13, 15] as const;

export const SUBTITLE_FONTS = ['Noto Sans KR Bold', 'Nanum Gothic Bold', 'Pretendard SemiBold', 'Apple SD Gothic Neo Bold'];
export const SUBTITLE_POSITIONS = ['bottom_center', 'bottom_left', 'lower_third', 'center_lower'];
export const SUBTITLE_TIMINGS = ['early', 'sync_dialogue', 'punchline_emphasis', 'fade_with_end'];
export const SUBTITLE_BOX_STYLES = ['semi_transparent', 'solid_dark', 'outline_only', 'rounded_pill'];

export const DEFAULT_VIDEO_PERSONAS: Record<Workspace, VideoPersonaConfig> = {
  yeonun: {
    relationshipAxes: [
      '부모-자녀',
      '시댁-며느리',
      '직장 상사-후배',
      '옛 친구 재회',
      '이웃집 사이',
      '연인 갈등',
      '형제자매',
      '사위-장인',
    ],
    emotionCurves: [
      '답답→통쾌',
      '평온→충격',
      '기대→허탈',
      '따뜻→냉소',
      '긴장→안도',
      '무심→감동',
    ],
    hookTypes: [
      '반전 한마디',
      '클리프행어',
      '말장난',
      '현실 직격',
    ],
    hookTypeMaxWeight: { 클리프행어: 0.2 },
    serviceConstraints: `연운 서비스 제약:
- 명리학 용어는 한글 발음 그대로만 (한자 병기 금지)
- "100%", "반드시", "확실히" 등 과장 확정 표현 금지
- 서비스 캐릭터(연화/별하/여연/운서) 비주얼·음성 등장 절대 금지
- 평서문 설명체로만 끝나는 대본 금지 — 펀치라인 필수
- 캐릭터 비노출: 매번 새로운 일반인만 등장`,
    cutTypeRule: DEFAULT_CUT_TYPE_RULE,
    shotStructure: DEFAULT_SHOT_STRUCTURE,
  },
  quizoasis: {
    relationshipAxes: [
      '친구끼리',
      '연인',
      '직장 동료',
      '가족',
      '첫 만남',
      '온라인 친구',
      '선후배',
    ],
    emotionCurves: [
      '호기심→깨달음',
      '가벼움→진지',
      '당황→웃음',
      '공감→여운',
      '긴장→해소',
    ],
    hookTypes: [
      '자기 발견',
      '반전 질문',
      '공감 한마디',
      '유머 포인트',
    ],
    serviceConstraints: `퀴즈오아시스 제약:
- 한국어 전용
- 특정 성격/심리 유형 단정·차별 표현 금지
- 의학적 진단 표현 금지
- 백과사전형 설명체 금지
- 매번 새로운 일반인 등장인물만 사용`,
    cutTypeRule: DEFAULT_CUT_TYPE_RULE,
    shotStructure: DEFAULT_SHOT_STRUCTURE,
  },
  panana: {
    relationshipAxes: [
      '캐릭터-일반인',
      '캐릭터-캐릭터',
      '캐릭터-독백',
      '캐릭터-상담자 역할',
    ],
    situationAxes: [
      '카페 대화',
      '밤 거리 산책',
      '집 안 1:1',
      '공원 벤치',
      '비 오는 창가',
      '전화 통화',
      '기다림',
    ],
    emotionCurves: [
      '불안→위로',
      '외로움→연결',
      '혼란→명료',
      '지침→희망',
      '답답→공감',
    ],
    hookTypes: [
      '따뜻한 한마디',
      '은유적 질문',
      '반전 공감',
      '조용한 통찰',
    ],
    serviceConstraints: `파나나 제약:
- 정신건강 진단·암시 표현 절대 금지
- 상담·치료 대체 인상 금지
- 뻔한 위로 멘트만으로 끝나는 대본 금지
- inactive 캐릭터 등장 금지
- 실제 파나나 캐릭터가 영상에 직접 등장`,
    cutTypeRule: DEFAULT_CUT_TYPE_RULE,
    shotStructure: DEFAULT_SHOT_STRUCTURE,
  },
};

export const SERVICE_URLS: Record<Workspace, string> = {
  yeonun: 'https://yeonun.kr',
  quizoasis: 'https://quizoasis.com',
  panana: 'https://panana.kr',
};
