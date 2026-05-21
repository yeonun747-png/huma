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
# Supabase: schema.sql → v3_5 → v3_7 → v3_8 → v3_9
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

## D. LTE 모뎀 10슬롯

```bash
# 3proxy (root)
sudo bash ~/huma/apps/server/scripts/setup-proxy.sh

# Supabase SQL Editor
# seed_modems_10slots.sql 실행

# 장치 확인
ip -br link | grep wwan
```

## 헬스체크

```bash
curl http://127.0.0.1:3100/api/health
curl https://api.huma.yourdomain.com/api/health   # Tunnel 사용 시
```
