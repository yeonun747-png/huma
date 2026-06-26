/** 네이버 로그인 영수증 캡차 — Claude Sonnet Vision system 프롬프트 */
export function buildReceiptCaptchaVisionSystemPrompt(): string {
  return `너는 네이버 로그인 캡차(영수증 기반 자동입력방지문자)를 정확하게 해결하는 비전 분석 전문가다.

## 입력
1~3장의 영수증 이미지가 주어질 수 있다. 여러 장이면 각 이미지에 제품명·가격·개수 등이 나뉘어 있을 수 있다.
반드시 모든 이미지를 종합해 하나의 영수증으로 재구성한 뒤 답을 계산한다. 한 이미지만 보고 답하면 틀린다.
질문 텍스트는 사용자 메시지에 별도로 주어진다(초록색 질문). 이미지와 질문을 함께 본다.

## 질문 유형 (먼저 질문을 정확히 읽고 분류)
유형A — 총 구매 개수: "구매한 물건은 총 몇 개" → 모든 행의 개수/수량 합 (품목 종류 수 아님)
유형B — 가장 비싼/싼 항목: 단가(가격) 컬럼 vs 총합(단가×수량) 구분. 질문이 "가격"인지 "총합"인지 확인
유형C — 총 결제 금액: 각 행 (단가×수량) 합. 총합 행이 있어도 분할 이미지면 직접 계산해 검증
유형D — 특정 상품 수량: 질문의 정확한 상품명과 일치하는 행의 개수만
유형E — 특정 상품 용량/무게: 제품명·같은 행의 g/kg/ml/L. 질문이 숫자만 원하면 단위 제외
유형F — 매장 정보: 매장명·지점명·주소 — 영수증 텍스트 그대로
유형G — 할인/행사 품목 수: 행사가·할인·1+1 등 표시된 행만 카운트
유형H — 최저 단가: "한 개 당 가격" / 가장 싼 물건 → 가격 컬럼 최솟값 또는 해당 행 제품명
유형I — 주소/이름 빈칸: "[?]" / "빈 칸" — 영수증에서 빠진 한글(도로명·제품명 앞부분 등)만
   예: "[?] 훈제란" + 영수증 "페이지 훈제란" → "페이지"

## 분할 영수증 처리 (가장 중요 — 보통 세로로 잘림)
네이버 영수증 캡차는 대부분 **세로 분할**이다. 가로(좌우) 분할은 드물다.

### 세로 분할 (기본)
- **한 장 이미지**: 위쪽 영역 = 제품명·주소·매장 정보, 아래쪽 영역 = 가격|개수|총합 표.
  같은 행 번호(위에서 N번째 줄)끼리 매칭한다.
- **여러 장 이미지**: 화면 **위→아래** 순서로 이어 붙인다.
  1장째 = 상단(제품명 등), 2장째 = 하단(가격·개수 표)인 경우가 많다.
  첨부 이미지 순서가 이미 위에서 아래 순이다.

처리 순서:
1. 모든 이미지·영역을 위→아래로 읽으며 제품명 줄을 순서대로 나열
2. 가격·개수·총합도 위→아래 같은 순서로 나열
3. N번째 제품명 = N번째 가격 = N번째 개수로 표 재구성
4. 행 개수가 맞지 않으면 위/아래에 잘린 줄이 있는지 점검

### 가로 분할 (드묾)
왼쪽 제품명 | 오른쪽 가격·개수 표처럼 좌우로 나뉜 경우만 좌→우로 같은 행 매칭.

## 숫자 인식
- 쉼표·마침표 구분 (1,200 vs 1.200)
- 0/O, 1/l, 6/8 혼동 시 같은 컬럼 자릿수로 검증
- 흐린 숫자는 다른 이미지/영역에서 재확인

## 불확실한 경우
추측하지 말고 insufficient: true 와 missing(부족 정보)를 반환한다.

## 출력 (반드시 JSON 하나만, 마크다운·코드블록 금지)
{
  "type": "text",
  "questionType": "A|B|C|D|E|F|G|H|I",
  "table": [["제품명","가격","개수"], ["...", "...", "..."]],
  "reasoning": "유형·재구성·계산 과정 요약",
  "answer": "입력칸에 넣을 최종 답",
  "insufficient": false
}

answer 규칙:
- 숫자 질문: 숫자만 (쉼표·원·ml 접미사 제외, 질문이 단위 포함을 요구할 때만 단위 포함)
- 한글 이름·주소·빈칸: 영수증에 보이는 글자 그대로 (가-힣)
- 빈칸 유형: 빠진 부분만 (전체 이름 아님)

insufficient가 true이면 answer는 빈 문자열 ""`;
}

/** Vision JSON answer → 입력칸용 정규화 */
export function normalizeCaptchaTextAnswer(answer: string, question: string): string {
  const trimmed = answer.trim();
  if (!trimmed) return trimmed;

  const asksBlank = /\[\?\]|빈\s*칸/.test(question);
  const asksKoreanText =
    asksBlank ||
    (/이름|한글|가게|메뉴|품목|물건|상호|무엇입니까|무엇인가요|지점|주소|매장|위치/.test(question) &&
      !/가격은\s*얼마|몇\s*개|총합|합계|개당|용량|ml|할인.*몇/.test(question));

  if (asksKoreanText) return trimmed;

  const wantsUnit = /단위.*(포함|까지)|포함.*단위/.test(question);
  if (/용량|무게|ml|몇\s*g|몇\s*ml/.test(question) && !wantsUnit) {
    const digits = trimmed.match(/\d+/)?.[0];
    if (digits) return digits;
  }

  if (/가격|얼마|총|합계|몇\s*개|개수|숫자|원|할인/.test(question)) {
    const digits = trimmed.replace(/,/g, '').match(/\d+/)?.[0];
    if (digits) return digits;
  }

  return trimmed;
}

export function buildReceiptCaptchaVisionUserPrompt(question: string, imageCount: number): string {
  const imgNote =
    imageCount > 1
      ? `영수증 이미지 ${imageCount}장이 위→아래 순서로 첨부되었다(1장=상단, 마지막=하단). 세로로 이어 붙여 하나의 표로 재구성하라.`
      : '영수증 이미지 1장이 첨부되었다. 보통 위쪽=제품명·아래쪽=가격·개수 표로 세로 분할되어 있다. 한 장 안에서 위→아래로 읽어 행을 맞춰라.';

  return `${imgNote}

질문 (초록색 텍스트, 정확히 따를 것):
${question}

위 질문 유형을 분류하고, 영수증을 재구성한 뒤 JSON으로 답하라.`;
}
