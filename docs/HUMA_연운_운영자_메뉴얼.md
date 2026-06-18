# HUMA 연운(緣運) 운영자 메뉴얼

> **대상:** 연운 워크스페이스를 운영하는 관리자  
> **UI 기준:** HUMA Studio v3.27 · Human Automation  
> **사이트:** [yeonun.com](https://yeonun.com) · 네이버 블로그 3계정(동글1~3)  
> **최종 갱신:** 2026-06-15

---

## 목차

1. [시작하기](#1-시작하기)
2. [사이드바 구조](#2-사이드바-구조)
3. [탑바 공통 조작](#3-탑바-공통-조작)
4. [공통 메뉴 (11)](#4-공통-메뉴)
5. [연운 특화 메뉴 (1)](#5-연운-특화-메뉴)
6. [시스템 메뉴 (2)](#6-시스템-메뉴)
7. [일일 운영 체크리스트](#7-일일-운영-체크리스트)
8. [장애 대응 빠른 참조](#8-장애-대응-빠른-참조)
9. [부록: 연운 인프라 매핑](#9-부록-연운-인프라-매핑)
   - [9.6 Telegram CAPTCHA (연운 그룹)](#96-telegram-captcha-연운-그룹)

---

## 1. 시작하기

### 1.1 로그인

1. HUMA 웹에 접속 후 관리자 계정으로 로그인합니다.
2. 사이드바 상단 **연운 緣運** 사업단이 선택되어 있는지 확인합니다.
3. 다른 사업단(퀴즈오아시스·파나나) 권한이 함께 있으면, 사이드바 상단 버튼으로 전환할 수 있습니다. **연운 작업 시 반드시 연운을 선택**하세요.

### 1.2 데이터 범위

| 구분 | 설명 |
|------|------|
| **워크스페이스 필터** | 대부분의 메뉴는 현재 선택된 사업단(`yeonun`) 데이터만 표시 |
| **전역 설정** | 휴먼 엔진·환경 설정·프록시는 전체 시스템에 적용 |
| **C-Rank 풀** | 50계정 공용 풀 — 연운 25 / 파나나 15 / 퀴즈 10 비율로 일일 선정 |

### 1.3 용어

| 용어 | 의미 |
|------|------|
| **post_blog** | AI 글 생성 → yeonun.com 랜딩 → 네이버 블로그 발행 파이프라인 |
| **content_full** | Claude + Imagen 통합 생성 job (파이프라인 shell) |
| **C-Rank** | 타 블로그 방문·공감·댓글·이웃 등 네이버 소통 자동화 |
| **Layer4** | CAPTCHA·429 등 Fail-Safe 감지 계층 |
| **동글** | i7 물리 SOCKS 프록시 슬롯 (연운 포스팅 = 슬롯 1~3) |

---

## 2. 사이드바 구조

연운 기준 사이드바는 **공통 11 · 연운 특화 1 · 시스템 2** 로 구성됩니다.

```
공통
 ├─ ⬡  대시보드          /dashboard
 ├─ ⊞  큐 관리            /queue          [배지: queue]
 ├─ ▦  스케줄 캘린더      /calendar
 ├─ ▣  발행 모니터        /monitor        [LIVE{n} 깜빡임]
 ├─ 📋 Operation Log     /oplog
 ├─ ◉  계정 관리          /accounts
 ├─ ▷  영상 파이프라인    /video-pipeline [배지: video]
 ├─ 🔍 SEO 키워드         /seo-keywords
 ├─ ⚠  Layer4 Watcher    /watcher        [배지: watcher, 빨간색]
 ├─ ⚙  휴먼 엔진 설정     /human-engine
 └─ 🔗 C-Rank 소통 관리   /crank

연운 특화
 └─ 🏛  카페 관리          /cafe-viral     ※ 연운 전용

시스템
 ├─ ⊕  프록시 관리        /modems
 └─ ◈  환경 설정          /settings
```

**사이드바 하단 상태**

- `시스템 정상 · 큐 활성 · N개 대기` — pending/scheduled job 수
- 사업단 hover **■** — 해당 사업단 긴급 정지 (`POST /api/stop-all`)

**연운에 없는 메뉴**

- `/adsense` (애드센스 수익) — **퀴즈오아시스 전용**

---

## 3. 탑바 공통 조작

모든 메뉴 상단 탑바에서 공통으로 사용합니다.

| 요소 | 기능 |
|------|------|
| **KST 시계** | 한국 표준시 현재 시각 |
| **다음 발행** | 가장 가까운 예약 job 시각 |
| **🔔 알림 센터** | 최근 ERROR 5건 · Layer4 관련 warn 표시 · 모두 읽음 |
| **⏹ 전체 중지** | 전체 job 중지 (사유 입력) |
| **▶ 재시작** | 중지 후 전체 재개 |
| **기간 선택** | 대시보드만: 오늘 / 이번주 / 이번달 |

---

## 4. 공통 메뉴

### 4.1 대시보드 `/dashboard`

**목적:** 연운 운영 현황을 한 화면에서 파악합니다.

#### 화면 구성

| 구역 | 내용 |
|------|------|
| **서비스 상태 카드** | 연운 🔮 LIVE/IDLE/오류 · 오늘 발행 건수 · **■ 정지** |
| **통계 4칸** | 오늘 총 발행 · 큐 대기 · 오류 · 활성 계정 |
| **7일 발행수 추이** | post_blog 파이프라인만 집계 · **평균선** + `평균 N 발행` 라벨 (수동 큐·shell job 제외) |
| **발행 콘텐츠 성과 · 상위 5** | GSC page 클릭(28일) ↔ `link_url` 매칭 · 미설정 시 SEO 메뉴 안내 |
| **오늘 발행 현황** | 연운 당일 완료 글 · **계정명** 열 (실제 네이버 URL만, UUID shell 제외) |
| **Bot Social Activity · 연운** | C-Rank KPI: 방문·공감·댓글·이웃·카페 소통 |

#### 주요 조작

- 기간 토글: **오늘 / 이번주 / 이번달**
- 활성 계정 카드 클릭 → `/accounts`
- 발행 URL `Layer4 감지 → 확인` → `/watcher`
- GSC 미설정 → `/seo-keywords` 연동 안내

#### 연운 참고

- GSC 사이트 URL: `https://yeonun.com/`
- 차트·오늘 발행·성과 TOP 5는 **동일 post_blog 필터** 사용
- 60초마다 자동 갱신

---

### 4.2 큐 관리 `/queue`

**목적:** AI 콘텐츠 생성·네이버 발행·C-Rank·CAPTCHA 대기 등 모든 job을 등록·모니터링·제어합니다.

#### 화면 구성

| 구역 | 내용 |
|------|------|
| **통계** | 총 대기 · 진행중 · 오늘 완료 · 완료 전체 |
| **발행 큐** | job 목록 (연운 = `#c0506e` 테두리) |
| **모달** | AI 자동 콘텐츠 · CAPTCHA 완료 · C-Rank 상세 · 포스트 뷰어 |

#### 주요 조작

| 액션 | 설명 |
|------|------|
| **+ 작업 추가** | AI 콘텐츠 모달 열기 |
| **항목 클릭** | CAPTCHA / C-Rank / 본문 미리보기 |
| **■** | LIVE job 강제 중단 |
| **일시정지 / 재개** | pending·scheduled job |
| **앞당김** | 예약 시각을 앞으로 당김 |
| **선택 삭제** | 완료·실패 job 일괄 삭제 |
| **실패·지연 선택** | failed·지연 job 일괄 선택 |
| **🔍 검증 미리보기** | dry_run 파이프라인 검증 |
| **🚀 AI 생성 + 발행 큐 등록** | 실제 생성·발행 등록 (이미지 업로드 중 **진행률 표시**) |

#### 작업 추가 주요 필드

| 필드 | 설명 |
|------|------|
| **제목** | SEO 제목 (Claude가 최적화) |
| **관련 URL** | 랜딩 URL (예: `https://yeonun.com/...`) |
| **시놉** | 운영자 시놉시스 (SEO 제목과 별도 보존) |
| **타입** | A(블로그) / B(영상) / 자동 |
| **자동 스케줄** | Haiku 기반 예약 시간 제안 |
| **예약 시간** | KST 기준 scheduled_at |

#### 상태 태그

| 태그 | 의미 |
|------|------|
| `CAPTCHA` | VNC에서 수동 해결 필요 |
| `LIVE` | 현재 실행 중 |
| `실패` / 지연(빨강) | failed 또는 예약 지난 pending |
| 완료(초록) | completed_at 표시 |

#### 연운 참고

- SEO 키워드 클릭 시 제목 + `https://yeonun.com` 프리필
- Type B → 영상 파이프라인 자동 연동
- OG 카드: yeonun.com 링크 삽입
- 5초 폴링 · 사이드바 **queue** 배지 = 대기 건수

#### 트러블슈팅

| 증상 | 조치 |
|------|------|
| CAPTCHA 대기 | **Telegram 그룹 답장** 또는 VNC → 로그인 → HUMA **발행·활동 재개** |
| `큐 데이터를 불러오지 못했습니다` | huma-server 연결·재시작 확인 |
| LIVE job 삭제 불가 | **■** 로 중단 후 삭제 |

---

### 4.3 스케줄 캘린더 `/calendar`

**목적:** 월별 발행 예약을 캘린더로 조감하고, 날짜별 job 확인·신규 예약을 등록합니다.

#### 화면 구성

- 월 캘린더 (헤더: `연운 · YYYY년 M월`)
- 날짜 클릭 → **발행 예약 조감** 드로어
- `JobScheduleForm` — job_type·title·scheduled_at·content

#### 주요 조작

| 액션 | 설명 |
|------|------|
| **◀ / 오늘 / ▶** | 월 이동 |
| **날짜 클릭** | 해당일 job 목록 |
| **+ 이 날짜에 예약** | 신규 job 등록 |
| **job 클릭** | 포스트 뷰어 |

#### job 유형 예

`post_blog` · `social_crank` · 카페 · TikTok · Instagram 등

#### 참고

- `content_full` 파이프라인 shell job은 캘린더에서 **제외**
- 예약 없는 날은 클릭 불가
- 기본 예약 시각: **10:00 KST**

---

### 4.4 발행 모니터 `/monitor`

**목적:** LIVE 네이버 타이핑·AI 생성·C-Rank 세션을 실시간으로 모니터링합니다.

#### 카드 유형

| 유형 | 표시 정보 |
|------|-----------|
| **LIVE** | 계정명 · WPM · 자수/전체 · 오타 · ETA |
| **AI** | Claude / Imagen 생성 단계 |
| **C-Rank** | crankPhase · phaseLabel |
| **대기** | pending/scheduled |
| **ERR** | 세션 오류 · **계정 관리 → 재연결** 링크 |

#### 연운 참고

- 연운 포스팅 계정(동글1~3) 세션이 여기 표시
- 사이드바 **LIVE{n}** = 현재 liveAccounts 수 (깜빡임)
- 5초 갱신

#### 트러블슈팅

| 증상 | 조치 |
|------|------|
| ERR 카드 | `/accounts`에서 해당 계정 재연결 |
| CAPTCHA | VNC 대기 → 큐에서 CAPTCHA 모달 |

---

### 4.5 Operation Log `/oplog`

**목적:** 최근 운영 로그를 KST 기준으로 조회합니다.

#### 화면 구성

| 구역 | 내용 |
|------|------|
| **요약** | 오늘 성공 / 오류 / 진행중 |
| **로그 테이블** | 최근 50건 |

#### 컬럼

`시각(KST)` · `서비스(연운)` · `계정` · `메시지` · `플랫폼` · `레벨` · `result_url`

#### 레벨 표시

| 표시 | level |
|------|-------|
| 성공 | INFO |
| 지연 | WARN |
| 실패 | ERROR |

#### 참고

- JSON 다운로드 API: 500건 (`huma-oplog-YYYY-MM-DD.json`) — UI 버튼 없음
- 탑바 🔔 알림 센터와 동일 ERROR 소스

---

### 4.6 계정 관리 `/accounts`

**목적:** 네이버 포스팅·C-Rank·카페·소셜 API 계정을 등록·편집·페르소나 관리합니다.

#### 화면 구성 (3열)

| 열 | 내용 |
|----|------|
| **포스팅 — 연운** | 동글1~3 · `:10001~03` · blog URL 필수 |
| **C-Rank + 카페** | CRANK-A~Y 등 연운 25계정 구간 |
| **소셜 — 연운** | TikTok · Threads · X · Instagram(단일) |

#### 주요 조작

| 대상 | 액션 |
|------|------|
| **포스팅** | + 계정 추가 · 편집(blog URL) · ▶ 모니터 · 페르소나 · 정지/재개 |
| **C-Rank/카페** | + 계정 추가 · 정지/재개 · 삭제 |
| **소셜** | + 계정 추가 · 재연결 · 삭제 |

#### 중요 필드

| 필드 | 설명 |
|------|------|
| `naver_id` / `naver_pw` | 네이버 로그인 |
| `blog_url` | **포스팅 필수** — 발행 job에 사용 |
| `crank_label` | CRANK-A ~ CRANK-Y |
| `health_score` | 75 미만 → warn |
| `blog_index` | 지수 (연운 포스팅 = 5) |
| `wpm` | 계정별 타이핑 속도 |

#### 상태

| 표시 | 의미 |
|------|------|
| `IDLE` | 대기 |
| `COOL` | 비활성 |
| `POSTING` / `C-RANK` / `CAFE` | 계정 유형 |
| blog URL 없음 | **warn** — 발행 불가 |

#### 연운 참고

- 포스팅 3계정 ↔ 프록시 슬롯 1~3 1:1 매핑
- Instagram은 퀴즈와 달리 EN/KR 분리 없이 **단일 계정**
- C-Rank 풀은 3사업단 **공용** (일일 비율 선정)
- 페르소나 오류 시 Supabase `huma_accounts` UUID 확인

---

### 4.7 영상 파이프라인 `/video-pipeline`

**목적:** Type B 콘텐츠의 Imagen → Higgsfield → ffmpeg → TikTok/IG/YT Shorts 파이프라인을 관리합니다.

#### 화면 구성

| 구역 | 내용 |
|------|------|
| **통계** | 오늘 생성 · 진행중 · 업로드 완료 · API 비용 |
| **모델 설정** | Imagen 4 · Haiku 자동 · Kling/Seedance · 오디오 |
| **4단계 파이프라인** | 이미지 → 영상 → 자막 → 업로드 진행 |
| **오늘 영상 작업** | job 테이블 |

#### 주요 조작

- 이미지/영상 모델 select · Haiku 자동 토글
- **🔍 조감** — 파이프라인 미리보기
- (dev) ▷ 시뮬

#### 설정 필드

| 필드 | 기본값 |
|------|--------|
| `default_image_model` | Imagen 4 |
| `default_video_model` | Kling 3.0 등 |
| `video_duration_sec` | 15 |
| `whisper_subtitle_sync` | 자막 싱크 |

#### 연운 참고

- 큐에서 Type B 등록 → 스케줄 자동 실행
- 기본 오디오: **Kling 3.0 내장 오디오** (TTS 불필요)
- 15초 폴링 · 사이드바 **video** 배지

#### 트러블슈팅

작업 없으면 → `/queue`에서 **🎬 영상 작업** 등록

---

### 4.8 SEO 키워드 `/seo-keywords`

**목적:** Search Console·job 집계 키워드를 추적하고, 큐 작업 프리필 소스로 활용합니다.

#### 화면 구성

| 구역 | 내용 |
|------|------|
| **안내 배너** | GSC 설정 상태 · missingEnv |
| **검색 순위 추적** | word · vol · chg (▲/▼) |
| **키워드 풀** | 사주·운세·꿈해몽 등 연운 키워드 |
| **콘텐츠↔키워드 맵** | 최상 / 양호 / 보강필요 / 부족 |

#### 주요 조작

- 키워드 태그 클릭 → `/queue` 모달 자동 입력 (제목 + `https://yeonun.com`)
- SEO 갱신 (내부 refresh)

#### 연운 참고

- 대시보드 **발행 콘텐츠 성과 TOP 5**와 GSC 연동
- GSC env: `GSC_*_YEONUN` · `GSC_SITE_URL` → `https://yeonun.com/`

#### 트러블슈팅

| 증상 | 조치 |
|------|------|
| `SEO API 오류` | 서버·OAuth refresh token 확인 |
| GSC 미설정 | missingEnv 항목 env 설정 |
| 순위 없음 | SEO 갱신 · crawl 실행 |

---

### 4.9 Layer4 Watcher `/watcher`

**목적:** CAPTCHA·429·휴식 등 Layer4 Fail-Safe **감지 이력·설정**을 확인합니다.

#### 화면 구성

| 구역 | 내용 |
|------|------|
| **요약** | 감지(오늘) · 기타 ERROR · Slack ON |
| **Fail-Safe 감지 이력** | Layer4 이벤트만 (CAPTCHA·429 등) |
| **Fail-Safe 설정** | auto_pause · captcha_slack · cooldown · gradual_recovery |
| **실시간 ERROR 로그** | 최근 ERROR 스트림 (Layer4 외 동글·워밍업 등 포함) |

#### 주요 조작

| 항목 | 설명 |
|------|------|
| Fail-Safe 토글 | 캡cha 감지 즉시 중지 · Slack · 429 쿨다운 · 점진적 복구 |

> Telegram 테스트·VNC 확인·CAPTCHA DRILL 버튼은 UI에서 제거됨. CAPTCHA 알림·답장은 **Telegram 그룹 + env** 로 운영 ([9.6](#96-telegram-captcha-연운-그룹) 참고).

#### 연운 참고

- i7 x11vnc 필요 (VNC 수동 해결 시)
- 사이드바 **watcher** 빨간 배지 = 미해결 Layer4 건수

#### 트러블슈팅

| 구분 | 설명 |
|------|------|
| Layer4 | CAPTCHA·429 — Watcher 범위 |
| 동글·워밍업·타임아웃 | 별도 처리 (Watcher 아님) |
| Telegram 알림 없음 | [9.6](#96-telegram-captcha-연운-그룹) env · BotFather · 그룹 초대 확인 |
| Telegram 답장 무응답 | **CAPTCHA 사진에 답장** · pm2 재시작 후 **새 알림**에 답장 · [8장](#8-장애-대응-빠른-참조) |

---

### 4.10 휴먼 엔진 설정 `/human-engine`

**목적:** 네이버 타이핑·마우스·핑거프린트·이미지 고유화·CAPTCHA 알림 등 Human Automation 파라미터를 조정합니다. **전역 설정** — 모든 사업단에 적용.

#### 화면 구성

| 패널 | 내용 |
|------|------|
| **타이핑 엔진** | WPM mean·σ·오타%·복붙%·WPM 분포 차트 |
| **활성 시간대** | 24h 히트맵 |
| **감지 방어·핑거프린트** | noise · canvas · WebGL 등 |
| **이미지 고유화** | EXIF/GPS 랜덤 · noise_pct |
| **Whisper 자막** | 영상 자막 싱크 |

#### 주요 파라미터 (기본값 참고)

| 파라미터 | 기본 | 설명 |
|----------|------|------|
| `wpm_mean` | 55 | 평균 타이핑 속도 |
| `typo_rate` | — | 오타 비율 |
| `paste_ratio` | 55% | 본문 붙여넣기 비율 |
| `crank_publish_ratio` | 1:3 | C-Rank : 발행 비율 |
| `captcha_slack/telegram/vision_auto` | — | CAPTCHA 알림·자동 시도 |
| `cooldown_429_hours` | — | 429 후 쿨다운 |
| `noise_pct` | — | 이미지 노이즈 |

#### 조작

- 슬라이더/토글 변경 → **500ms debounce 자동 저장** (별도 저장 버튼 없음)

#### 연운 참고

- 본문 붙여넣기 시 `https://yeonun.com` OG 카드 시뮬
- 발행 전 검토 대기: 2~5분
- CAPTCHA Vision 3회 실패 → Telegram 그룹 알림 → **답장** 또는 VNC
- 2차 CAPTCHA·로그인 재시도 시 nidlogin **ID·비밀번호 자동 재입력** (필드가 비워진 경우)

---

### 4.11 C-Rank 소통 관리 `/crank`

**목적:** 블로그 소통(방문·공감·댓글·이웃)·카페 타겟·스케줄러·자동화 설정을 운영합니다.

#### 탭 구조

**① 피드**

| 구역 | 내용 |
|------|------|
| **KPI 4종** | 방문·공감·댓글·이웃 (progress bar) |
| **계정별 카드** | 서비스 필터: **연운** / 퀴즈 / 파나나 |
| **활동 피드** | 유형별 색상 (방문·공감·댓글·이웃) |
| **소통 자동화 설정** | enabled · auto_comment · auto_neighbor · cafe_enabled |

**② 운영**

| 구역 | 내용 |
|------|------|
| **스케줄러 KPI** | 일일 세션·완료율 |
| **동글 6·7 테이블** | slot6·7 C-Rank 실폰 |
| **계정 스케줄** | track0→`:10006` · track1→`:10007` |
| **소통 대상 목록** | 타겟 블로그 URL |

#### 주요 조작

| 액션 | 설명 |
|------|------|
| 기간 | 오늘 / 어제 / 7일 / 한달 |
| 서비스 필터 | **연운** |
| **▶ 수동 1회 실행** | social_crank job 즉시 등록 |
| **점사모 신규글 크롤링** | 카페 타겟 crawl |
| **다시 검사** | 슬롯 6·7 SOCKS probe |
| **동글 네트워크 복구** | 일괄 reconnect |

#### 설정 (`social_crank`)

| 필드 | 설명 |
|------|------|
| `daily_visit_limit` | 200 (기본) |
| `keyword_pools` | 서비스별 키워드 풀 |
| 세션 | 45분 · 동글당 일 6세션 · 08~22시 분산 |
| 비율 | 타 블로그 75% / 우리 포스팅 25% |

#### 연운 참고

- 연운 C-Rank: CRANK-A ~ CRANK-Y (25계정)
- 대시보드 `yeonunSocial`·키워드 피드와 연동
- 매일 **00:01 KST** 자동 큐 등록
- 카페 소통 ↔ `/cafe-viral` 연계

#### 트러블슈팅

| 증상 | 조치 |
|------|------|
| 스케줄러 API 실패 | 재시도 · huma-server 로그 |
| CRANK 계정 없음 | `/accounts`에서 C-Rank 계정 등록 |
| `(검사 중…)` | probe 완료 대기 (30~45s) |

---

## 5. 연운 특화 메뉴

### 5.1 카페 관리 `/cafe-viral`

**목적:** 네이버 카페(점사모 등) 바이럴·자문자답·댓글 활동을 KPI·피드·타겟 등록·키워드 스캔으로 관리합니다.

> **연운 전용** — yeonun 외 워크스페이스 접근 시 `/dashboard`로 리다이렉트

#### 화면 구성

| 구역 | 내용 |
|------|------|
| **KPI** | 크롤링 게시글 · 오늘 활동 · 자문자답 · 진성 유저 반응 |
| **등록 카페 목록** | 좌측 사이드 — 카페 선택 |
| **활동 피드** | 유형 필터 · 펼치기 |
| **타겟 등록 폼** | cafe_url · cafe_name · category · keywords |

#### 주요 조작

| 액션 | 설명 |
|------|------|
| **+ 타겟 등록** | 폼 표시 |
| **등록** | 신규 카페 타겟 저장 |
| **↻ 키워드 스캔** | 선택 카페 키워드 크롤 |
| **카페에서 보기 ↗** | 네이버 카페 링크 |

#### 피드 유형

| 유형 | 설명 |
|------|------|
| `HUMA 글` | 자체 게시 |
| `자문자답` | is_self_post |
| `댓글` | reply_posted |
| `공감` | — |
| `진성유저` | 유기적 반응 |

#### 반응 상태

`답글 완료` · `미답글` · pending

#### 연운 참고

- C-Rank 「카페 소통」토글(`cafe_enabled`)과 연계
- API 실패 시 mock 데이터 폴백 (개발/미배포 환경)
- workspace=`yeonun` 고정

#### 트러블슈팅

| 증상 | 조치 |
|------|------|
| `활성 타겟 카페를 먼저 등록` | 카페 등록 후 스캔 |
| 스캔 실패 alert | cafe_url·keywords 확인 |

---

## 6. 시스템 메뉴

### 6.1 프록시 관리 `/modems`

**목적:** i7 물리 동글 1~7 SOCKS·공인 IP·지역·응답 ms를 검사하고 네트워크/IP를 복구합니다.

#### 슬롯 매핑

| 슬롯 | 포트 | 용도 |
|------|------|------|
| 1~3 | :10001~10003 | **연운 포스팅** (동글1~3) |
| 4 | :10004 | 파나나 |
| 5 | :10005 | 퀴즈오아시스 |
| 6~7 | :10006~10007 | C-Rank 실폰 |
| 8~10 | — | 미사용 |

#### 주요 조작

| 액션 | 설명 |
|------|------|
| **다시 검사** | SOCKS probe (30~45s) |
| **🔧 동글 네트워크 일괄 복구** | restore-network |
| **동글 N IP 재발급** | 단일 슬롯 reconnect |

#### 상태

| 표시 | 의미 |
|------|------|
| `정상` | SOCKS OK |
| `오류` | 45s 타임아웃 |
| `검사중` | probe 진행 |
| `재연결` / `오프라인` / `사용중` | 세션 상태 |

#### 연운 참고

- 연운 포스팅 3동글 = 계정 관리 「동글1~3 · :10001~03」**1:1**
- UI 오류만으로 큐는 막히지 않으나, 실행 중 SOCKS 실패 가능

#### 트러블슈팅 순서

1. **동글 네트워크 일괄 복구**
2. **다시 검사**
3. 문제 슬롯만 **IP 재발급**

---

### 6.2 환경 설정 `/settings`

**목적:** C-Rank/포스팅 활동 ON/OFF, 외부 API 연결, 포스팅 워밍업 확률, 발행 제한·Watcher 연동을 설정합니다. **전역 설정.**

#### 화면 구성

| 섹션 | 내용 |
|------|------|
| **활동** | C-Rank 활동 ON/OFF · 포스팅 활동 ON/OFF |
| **API 연결** | Claude Sonnet/Haiku · Imagen 4 · Higgsfield · Slack |
| **포스팅 워밍업** | skip / light / full % (합계 100% 권장) |
| **발행 제한** | 일일 30건 · 야간 금지(01~07) · Layer4 자동 일시정지 · 점진적 복구 |

#### 주요 조작

- 각 `SettingsToggle` ON/OFF → 즉시 `PUT /api/settings/*`

#### 연운 영향

| 설정 | OFF 시 |
|------|--------|
| **C-Rank 활동** | 연운 소통·카페 큐 **중지** |
| **포스팅 활동** | AI 생성·네이버 발행 **중지** |

#### 참고

- C-Rank OFF ≠ 탑바 **▶ 재시작** (별개 동작)
- Layer4 설정은 `/watcher`와 일부 키 중복 (`watcher.auto_pause` 등)
- 워밍업 합계 100% = 초록, 아니면 warn (자동 정규화)

---

## 7. 일일 운영 체크리스트

### 아침 (08:00 전후)

- [ ] `/dashboard` — 오늘 발행·큐 대기·오류 확인
- [ ] `/modems` — 연운 슬롯 1~3 **정상** 확인
- [ ] `/monitor` — LIVE/ERR 세션 없음 확인
- [ ] `/watcher` — Layer4 미해결 건 확인 (빨간 배지)

### 발행 운영

- [ ] `/seo-keywords` — 키워드·순위 확인 → 필요 시 `/queue` 등록
- [ ] `/queue` — CAPTCHA·지연 job 처리 (Telegram **답장** 또는 VNC)
- [ ] `/calendar` — 당일·내일 예약 확인

### 소통 운영

- [ ] `/crank` — 연운 KPI·피드 확인
- [ ] `/cafe-viral` — 점사모 등 카페 미답글 처리 · 키워드 스캔

### 저녁 마감

- [ ] `/dashboard` — 오늘 발행 현황·7일 차트 확인
- [ ] `/oplog` — ERROR 로그 검토
- [ ] `/accounts` — 세션 오류·health_score warn 계정 확인

---

## 8. 장애 대응 빠른 참조

| 증상 | 1차 확인 | 2차 조치 |
|------|----------|----------|
| CAPTCHA 반복 | `/watcher` · `/queue` CAPTCHA | Telegram **답장** 또는 VNC → **발행·활동 재개** |
| Telegram 답장 안 먹음 | CAPTCHA **사진**에 답장했는지 | pm2 재시작 직후면 **새 CAPTCHA** 대기 · [9.6](#96-telegram-captcha-연운-그룹) |
| `getUpdates Conflict` (서버 로그) | 브라우저 getUpdates 탭 · 로컬 `npm run dev` | i7 `huma-server` 1개만 · [9.6.4](#964-getupdates-충돌-conflict) |
| 발행 ERR | `/monitor` ERR 카드 | `/accounts` 재연결 · `/modems` 검사 |
| SOCKS 오류 | `/modems` 슬롯 1~3 | 일괄 복구 → 재검사 |
| 큐 지연(빨강) | `/queue` scheduled_at | 앞당김 또는 재등록 |
| Layer4 감지 | `/watcher` 이력 | Fail-Safe 설정 · Telegram 확인 |
| GSC/SEO 없음 | `/seo-keywords` missingEnv | env OAuth·GSC_SITE_URL 설정 |
| 전체 중지 필요 | 탑바 **⏹ 전체 중지** | 사유 입력 · 복구 후 **▶ 재시작** |
| 연운만 긴급 정지 | 사이드바 연운 hover **■** | 사유 입력 |

---

## 9. 부록: 연운 인프라 매핑

### 9.1 포스팅 계정 ↔ 동글

| 계정 | crank_label / 이름 | SOCKS 슬롯 | 포트 |
|------|-------------------|------------|------|
| 동글1 | (포스팅 계정 1) | slot 1 | :10001 |
| 동글2 | (포스팅 계정 2) | slot 2 | :10002 |
| 동글3 | (포스팅 계정 3) | slot 3 | :10003 |

### 9.2 C-Rank 연운 구간

- **CRANK-A ~ CRANK-Y** (25계정)
- DB: `huma_accounts.crank_workspace = 'yeonun'`
- 일일 선정: 전체 50계정 풀에서 연운 25 / 파나나 15 / 퀴즈 10 **비율** 교차 배치

### 9.3 발행 파이프라인 (post_blog)

```
Claude SEO 글 생성
  → yeonun.com 랜딩 (link_url)
  → 네이버 에디터 타이핑 (Human Engine)
  → result_url (blog.naver.com)
  → GSC 유입 집계 (대시보드 TOP 5)
```

### 9.4 환경 변수 (연운 GSC 예시)

| 변수 | 용도 |
|------|------|
| `GSC_CLIENT_ID_YEONUN` | OAuth |
| `GSC_CLIENT_SECRET_YEONUN` | OAuth |
| `GSC_REFRESH_TOKEN_YEONUN` | OAuth |
| `GSC_SITE_URL` 또는 `GSC_SITE_URL_YEONUN` | `https://yeonun.com/` |

### 9.5 서버 배포 (i7)

```bash
cd ~/huma && git pull
cd apps/server && npm run build
pm2 restart huma-server --update-env
```

웹 UI 변경은 Vercel 별도 배포.

> CAPTCHA Telegram 답장 수신 등 **서버 코드** 변경 후에는 위처럼 `apps/server` 빌드·재시작이 필요합니다.

### 9.6 Telegram CAPTCHA (연운 그룹)

연운 CAPTCHA는 **1:1 DM이 아니라 텔레그램 그룹** `연운 Huma 알림` 으로 알림을 보내고, 운영자가 **답장**으로 정답을 입력하면 i7 huma-server가 VNC 브라우저에 자동 입력합니다.

#### 9.6.1 초기 설정

| 단계 | 내용 |
|------|------|
| 1 | BotFather → `@Yeonunbot` → **Group Privacy → Turn off** (Privacy **비활성** = 그룹 답장 수신) |
| 2 | 그룹 `연운 Huma 알림`에 봇 초대 |
| 3 | i7 `apps/server/.env` 설정 (아래) |
| 4 | `pm2 restart huma-server --update-env` |

**`.env` 예시 (연운)**

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID_YEONUN=-5583641706
TELEGRAM_INBOUND_POLL=true
HUMA_WEB_URL=https://romang-ai.com
HUMA_VNC_URL_YEONUN=vnc://172.30.1.96:5900
```

| 변수 | 설명 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | BotFather 발급 토큰 |
| `TELEGRAM_CHAT_ID_YEONUN` | 그룹 chat id (음수). 슈퍼그룹이면 `-100…` 형식일 수 있음 — 최신 서버는 자동 매칭 |
| `TELEGRAM_INBOUND_POLL` | i7 production에서 `true` (답장 수신). dev PC `npm run dev` 는 기본 OFF |
| `HUMA_VNC_URL_YEONUN` | RealVNC 등 VNC 링크 (알림 본문에 표시) |

**`.env` 작성 주의**

- **한 줄에 `KEY=value` 하나** — 줄바꿈 누락 시 `TELEGRAM_CHAT_ID…HUMA_API_SECRET=…` 처럼 붙어서 오류
- `source .env` 테스트 시와 PM2(dotenv) 로드 결과가 다를 수 있음 — 형식은 항상 한 줄씩

#### 9.6.2 CAPTCHA 정답 보내는 방법

1. 그룹에 온 **CAPTCHA 사진·알림**을 선택
2. **답장(Reply)** 으로 정답 입력 (일반 채팅만 보내면 Privacy ON 그룹에서는 수신 안 될 수 있음)
3. 입력 형식: 한글·숫자만, 또는 `정답: xxx` / `@Yeonunbot 정답`
4. 처리 결과: 그룹에 `✅` / `❌` / `⚠️` 봇 메시지
5. CAPTCHA 통과 후 huma **큐 → 발행·활동 재개**

CAPTCHA 대기 job이 **1개**이면 답장 대상만 맞으면 job 자동 연결. **여러 개**이면 반드시 **해당 CAPTCHA 알림에 답장**.

#### 9.6.3 pm2 재시작 시 주의

| 항목 | 설명 |
|------|------|
| **답장 매핑** | 알림 `message_id → job_id` 는 **메모리** — `pm2 restart` 후 **사라짐** |
| **CAPTCHA 세션** | 브라우저 hold도 재시작 시 끊길 수 있음 |
| **운영 규칙** | 재시작·배포 후에는 **새 CAPTCHA 알림**이 온 뒤 그 알림에 답장 |

#### 9.6.4 getUpdates 충돌 (Conflict)

서버 로그에 `Conflict: terminated by other getUpdates request` 가 나오면 **같은 봇 토큰으로 getUpdates를 두 곳에서 동시에** 쓰는 상태입니다.

| 원인 | 조치 |
|------|------|
| 브라우저 `api.telegram.org/bot…/getUpdates` 탭 | **전부 닫기** |
| Windows 등에서 `npm run dev` (같은 `.env` 토큰) | dev 서버 **종료** |
| i7 `huma-server` 중복 | `pm2 list` — 1개만 |
| huma-server **가동 중** curl getUpdates | **하지 말 것** (Conflict 유발) |

**진단 (i7)**

```bash
pm2 stop huma-server
sleep 10
# TOKEN은 .env에서 — huma-server 중지 상태에서만 1회
curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=1&limit=1"
# {"ok":true,"result":[]} 이면 외부 소비자 없음
pm2 start huma-server --update-env
```

**로그 확인**

```bash
pm2 logs huma-server --lines 50 --nostream | grep telegram-inbound
```

- `CAPTCHA 정답 수신 폴링 시작` — 정상 기동
- Conflict **반복** — 위 표 재확인
- 폴링 중에는 로그가 거의 없음 (정상). 답장 시 `recv chat=…` / `CAPTCHA answer …` 기대

#### 9.6.5 chat_id 불일치

답장 시 봇이 `chat_id 불일치` 안내를 보내면:

1. 안내에 나온 **수신 id** 를 `.env` `TELEGRAM_CHAT_ID_YEONUN` 에 반영 (기존 id와 **쉼표**로 병기 가능)
2. `pm2 restart huma-server --update-env`

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-15 | Telegram 그룹 CAPTCHA·getUpdates Conflict·UI(대시보드·큐·Watcher) 반영 |
| 2026-06-15 | 최초 작성 — 연운 사이드바 전 메뉴 운영자 메뉴얼 |
