#!/usr/bin/env bash
# Playwright Chromium (CAPTCHA DRILL · 네이버 발행)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Playwright Chromium install (apps/server) =="
npx playwright install chromium
echo ""
echo "OK — $(ls -d "$HOME"/.cache/ms-playwright/chromium-* 2>/dev/null | tail -1 || echo 'check ~/.cache/ms-playwright')"
