# HUMA i7 Ubuntu Worker 배포 파일

i7 노트북(Ubuntu)에서 **API + BullMQ Worker + Playwright** 를 상시 운영하기 위한 설정입니다.

## 파일 목록

| 파일 | 용도 |
|------|------|
| `ecosystem.config.cjs` | PM2 (Xvfb + server) |
| `setup-pm2.sh` | PM2 원클릭 등록 |
| `huma-xvfb.service` | systemd — 가상 디스플레이 :99 |
| `huma-server.service` | systemd — Node Worker |
| `setup-systemd.sh` | systemd 원클릭 등록 |
| `cloudflare-tunnel.yml` | Tunnel ingress (API :3100) |
| `setup-cloudflare-tunnel.sh` | Tunnel 설치·DNS·systemd |
| `../scripts/migrations/seed_modems_10slots.sql` | LTE 모뎀 10슬롯 DB |

## 사전 준비

```bash
# Redis, FFmpeg, Xvfb, Node 20+, repo clone, npm install
# apps/server/.env 작성
# Supabase: schema.sql → v3_5 → … → v3_19 → v3_21
```

## A. PM2로 운영 (간단)

```bash
cd ~/huma/apps/server/deploy
bash setup-pm2.sh
pm2 startup    # 출력된 sudo 명령 실행
pm2 save
```

## B. systemd로 운영 (서버형)

기본 경로: `/home/huma/huma` · 사용자 `huma`

```bash
# repo를 /home/huma/huma 에 clone, .env 설정, build 완료 후
cd ~/huma/apps/server/deploy
sudo HUMA_USER=huma HUMA_HOME=/home/huma/huma bash setup-systemd.sh

journalctl -u huma-server -f
```

## C. Cloudflare Tunnel (Vercel → i7 API)

```bash
# 1) 사용자로 tunnel 생성 (최초 1회)
cloudflared tunnel login
cloudflared tunnel create huma-studio
# credentials: ~/.cloudflared/<TUNNEL_ID>.json

# 2) root로 등록
sudo cp ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/huma-studio.json
cd ~/huma/apps/server/deploy
sudo bash setup-cloudflare-tunnel.sh api.huma.yourdomain.com
```

Vercel:

```env
NEXT_PUBLIC_HUMA_API_URL=https://api.huma.yourdomain.com
```

## D. LTE 모뎀 10슬롯 (v3.10 확정)

i7 노트북 1대 · USB 허브 10포트 · 동글 10개 (포스팅 4 + C-Rank·카페 6 순환)

```bash
# 3proxy (root)
sudo bash ~/huma/apps/server/scripts/setup-proxy.sh

# Supabase SQL Editor
# v3_9_fds_watcher.sql → v3_9_1_modem_roles.sql → v3_10_social_crank.sql → v3_11_youtube.sql
# seed_modems_10slots.sql

# 장치 확인
ip -br link | grep wwan
```

> v3.21: LTE 유심 **KT 초알뜰 10개** (포스팅 4×2GB + C-Rank·카페 6×3GB) · 월 약 45,000원

> v3.9 레거시: `seed_modems_7slots.sql` / `seed_modems_20slots.sql` / 노트북 B 워커(`worker-only.ts`)는 사용하지 않음.

## E. (레거시) v3.9 노트북 B 워커

v3.10부터 **단일 i7** 운영. 아래는 v3.9 2대 분산 시에만 참고.

```bash
# REDIS_HOST=마스터 LAN IP, npm run start:worker
# PM2: ecosystem에 huma-worker-b 앱을 수동 추가
```

## 헬스체크

```bash
curl http://127.0.0.1:3100/api/health
curl https://api.huma.yourdomain.com/api/health   # Tunnel 사용 시
```
