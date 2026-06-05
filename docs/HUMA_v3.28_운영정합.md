# HUMA v3.28 기획서 ↔ 현행 코드 운영 정합 (2026-06-06)

원본: `HUMA_개발기획서_v3.28.md`  
**v3.28 C-Rank 서비스별 분리 배정 — 아래 마이그레이션 실행 후 반영됩니다.**

## C-Rank 50계정 서비스 배정 (v3.28)

| 서비스 | 레이블 구간 | 수 |
|--------|-------------|-----|
| 연운 | CRANK-A ~ CRANK-Y | 25 |
| 파나나 | CRANK-Z ~ CRANK-AN | 15 |
| 퀴즈오아시스 | CRANK-AO ~ CRANK-AX | 10 |

- DB 컬럼: `huma_accounts.crank_workspace` (`yeonun` / `panana` / `quizoasis`)
- 활동 비율: **타 블로그 75%** (네이버 `where=blog` 검색) / **우리 포스팅 25%** (서비스별)
- 키워드: `social_crank.keyword_pools` 서비스별 풀 · 세션당 4개 랜덤
- Haiku 댓글: 서비스 맥락 (`crank-comment.ts`)

## v3.27 대비 유지 (변경 없음)

| 항목 | 현행 |
|------|------|
| 물리 동글 | **7개** (포스팅5 + C-Rank2 슬롯6·7) |
| slot4 | **파나나** · slot5 **퀴즈오아시스** |

## Supabase 마이그레이션 (순서)

1. `v3_35_v327_schema_align.sql` — crank_label 등 (이미 실행 시 생략)
2. **`v3_36_crank_workspace.sql`** — crank_workspace + 50계정 재배정 + social_crank JSON
3. **`v3_37_crank_ratio_75_25.sql`** — 비율 75/25 (v3_36 실행 후)

## 배포

```bash
# i7
git pull && cd apps/server && npm run build && pm2 restart huma-server
# Supabase SQL Editor: v3_36 실행
# Vercel: web git pull
```

## UI

- **계정 관리**: C-Rank를 연운25 / 파나나15 / 퀴즈10 섹션으로 표시
- **C-Rank 소통**: 서비스 필터 탭 (전체·연운·파나나·퀴즈)
