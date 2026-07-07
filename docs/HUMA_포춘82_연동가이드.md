# 포춘82 × HUMA 연동 가이드

포춘82 **물리 서버**에 상품 목록 API를 만들어 주세요.

---

## API

```
GET https://www.fortune82.com/api/huma/products
```

- 인증: `Authorization: Bearer {키}` 또는 `x-api-key: {키}`
- 서버 env: `FORTUNE82_HUMA_API_KEY` (HUMA 팀과 **동일 값**으로 맞춤)

---

## HUMA 호출 시각

**매일 06:45 (한국시간)** 에 HUMA가 위 API를 **1회** 호출합니다.

- HUMA **블로그·숏폼·롱폼** 제작에 이 캐시를 사용
- **06:00~07:00** 사이 API가 정상 응답하면 됨

**응답 없음·오류(야간 점검 등)**

- 그날은 **마지막으로 받아 둔 상품 목록**으로 제작 계속
- 당일 재호출 없음 → **다음 날 06:45**에 다시 1회 요청

---

## 내려줄 필드

| 필드 | 내용 |
|------|------|
| `id` | 상품 고유키 (예: `"13-4032"`) |
| `gc`, `ic` | 상품 URL용 (`form.html?gc=13&ic=4032`) |
| `title` | 상품 제목 |
| `teacher_name` | 선생님 이름 (예: 월신당) |
| `intro` | 상품 소개 — **`[상품구성]` 앞**까지 |
| `composition` | **`[상품구성]` 블록** 전체 |
| `price` | 가격 숫자만 (예: `38500`) |
| `status` | `active` / `inactive` (기본 `active`) |

**넣지 않을 것:** 가격 아래 하단 안내·면책 문구

---

## 응답 예시

```json
{
  "products": [
    {
      "id": "13-4032",
      "gc": 13,
      "ic": 4032,
      "title": "신점 궁합",
      "teacher_name": "월신당",
      "intro": "귀신의 뒷 그림자도…\n해당 컨텐츠는 약 13,000자 제공돼요.\n…",
      "composition": "[상품구성]\n\n■ 신이 내린 소연\nㆍ…",
      "price": 38500,
      "status": "active"
    }
  ]
}
```

---

## 규칙

1. 노출 중인 상품만 `active`로 포함
2. 목록에서 빠진 상품 → HUMA가 `inactive` 처리 (삭제 아님)
3. `gc` / `ic` = 상품 페이지 URL 쿼리 (대분류 / 개별 상품)

---

## 체크리스트

- [ ] `GET /api/huma/products` 배포
- [ ] `FORTUNE82_HUMA_API_KEY` 설정 → HUMA에 키 전달
- [ ] 필드·응답 형식 확인
