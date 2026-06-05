# HUMA v3.27 기획서 ↔ 현행 코드 운영 정합 (2026-06-05)

원본: `HUMA_개발기획서_v3.27.md`  
**아래 항목은 i7 실운영·코드 기준으로 기획서와 다릅니다. 문서 읽을 때 이 파일을 함께 보세요.**

## 하드웨어

| 항목 | 기획서 v3.27 | **현행 (확정)** |
|------|----------------|-----------------|
| 물리 동글 | 10개 (포스팅5 + C-Rank5) | **7개** (포스팅5 + **C-Rank2** 슬롯6·7) |
| SOCKS 포트 | :10001~:10010 | **:10001~:10007** (8~10 DB reserved) |
| 복구 스크립트 | — | `sudo bash apps/server/scripts/restore-dongle-by-subnet.sh` |

## 포스팅 슬롯 ↔ 서비스

| 슬롯 | 기획서 | **현행 코드·restore** |
|------|--------|----------------------|
| 4 | 퀴즈오아시스 | **파나나** (:10004) |
| 5 | 파나나 | **퀴즈오아시스** (:10005) |

## C-Rank 계정

| 항목 | 기획서 | **현행** |
|------|--------|----------|
| 초기 수 | CRANK-A~J (10) | **50계정** (v3_34) |
| 레이블 | `crank_label` CRANK-A~J | **CRANK-A ~ CRANK-AX** (50개, v3_35 백필) |
| 표시명 `name` | — | 엑셀 페르소나 영문명 |
| 스케줄 풀 | 10 고정 | **DB 활성 crank 수** (현재 50) |
| C-Rank 동글 | slot 6~10 순환 | **slot 6·7** (:10006·:10007) |

## v3.27 UI — 구현 상태

| 기능 | 상태 |
|------|------|
| 대시보드 시계·ROAS·정지사유·오류링크 | ✅ |
| 큐 색상보더·앞당기기·최적시간 체크 | ✅ |
| PostViewer 공통 모달 | ✅ |
| 발행 모니터 오류카드·ETA | ✅ |
| 캘린더 **발행 있는 날만** 클릭 | ✅ (v3.35) |
| 사이드바 **LIVE{N}** 계정 수 | ✅ (v3.35) |
| C-Rank `data-acct` + CRANK-A 필터 | ✅ (v3.35) |
| SEO CORE 메뉴 | ✅ |
| `/ws/pipeline`, `/ws/queue` | ⏳ 미구현 (폴링으로 대체) |

## Supabase 마이그레이션 (순서)

1. `v3_33_modem_public_geo.sql` — 공인 IP·지역
2. `v3_34_crank_50_yeonun.sql` — 50계정 (이미 실행 시 생략)
3. **`v3_35_v327_schema_align.sql`** — crank_label, advance_requested_at, stop_reason

## 배포

```bash
# i7
git pull && cd apps/server && npm run build && pm2 restart huma-server
# Supabase: v3_35 실행 후 웹 git pull
```
