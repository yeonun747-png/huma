import { describe, expect, it } from 'vitest';
import { parseQuizImagePrompts, buildQuizImageFilename } from '@huma/shared';

const PREFIX = 'p3_test_solo_drinking_type_';

describe('parseQuizImagePrompts', () => {
  it('parses 4-choice sample (Q1 only)', () => {
    const raw = `Q1. 혼술을 시작하기 전 나의 준비 과정은?
• A. 🖼️ 조명을 바꾸고 음악을 틀며 분위기를 세팅한다
• B. 🖼️ 볼 영상이나 드라마를 미리 고른다
• C. 🖼️ 안주를 정성스럽게 준비하거나 시킨다
• D. 🖼️ 냉장고에서 바로 꺼낸다. 준비 같은 건 없다
________________________________________
[Q1 선택지 이미지 프롬프트]
• A 이미지: 혼술 전 블루투스 스피커에 음악을 연결하고 무드등이나 캔들을 켜서 분위기를 세팅하는 장면 클로즈업.
• B 이미지: 소파에 앉아 리모컨을 들고 넷플릭스·유튜브 화면에서 볼 것을 고르는 장면.
• C 이미지: 주방에서 안주를 정성스럽게 준비하거나 배달 앱에서 안주를 고르는 장면.
• D 이미지: 퇴근 후 코트도 안 벗고 냉장고를 열어 바로 캔맥주를 꺼내는 장면.`;

    const result = parseQuizImagePrompts(raw, PREFIX);
    expect(result.totalImages).toBe(4);
    expect(result.choiceType).toBe('4지선다');
    expect(result.questions[0]?.isFaceQuestion).toBe(false);
    expect(result.questions[0]?.choiceCount).toBe(4);
    expect(result.items[0]?.filename).toBe(`${PREFIX}q1_a.png`);
    expect(result.items[3]?.filename).toBe(`${PREFIX}q1_d.png`);
  });

  it('parses 2-choice sample', () => {
    const raw = `Q1. 오늘 아침 창문을 열었을 때 보고 싶은 풍경은?
• A. 🖼️ 눈부시게 맑고 파란 하늘. 구름 한 점 없는 아침
• B. 🖼️ 부슬부슬 빗소리가 들리는 촉촉한 회색 아침
________________________________________
[Q1 선택지 이미지 프롬프트]
• A 이미지: 창문 너머로 보이는 구름 한 점 없는 완벽한 코발트 블루 아침 하늘.
• B 이미지: 창문 유리에 빗방울이 맺히고 흘러내리는 클로즈업.`;

    const result = parseQuizImagePrompts(raw, PREFIX);
    expect(result.totalImages).toBe(2);
    expect(result.choiceType).toBe('2지선다');
  });

  it('detects face (총면) question', () => {
    const raw = `Q3. 이 장면을 고르세요
• A. 🖼️ A
• B. 🖼️ B
________________________________________
[Q3 총면 이미지 프롬프트]
• 이미지: 정면을 바라보는 인물 클로즈업 화보.`;

    const result = parseQuizImagePrompts(raw, PREFIX);
    expect(result.questions[0]?.isFaceQuestion).toBe(true);
    expect(result.items[0]?.filename).toBe(buildQuizImageFilename(PREFIX, 3, null));
    expect(result.items[0]?.choiceId).toBeNull();
  });
});
