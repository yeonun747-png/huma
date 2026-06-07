/** @type {import('pm2').StartOptions[]} */
const path = require('path');

const serverRoot = path.join(__dirname, '..');
const deployRoot = __dirname;

module.exports = {
  apps: [
    {
      name: 'huma-xvfb',
      script: path.join(deployRoot, 'scripts/start-xvfb.sh'),
      interpreter: 'bash',
      autorestart: true,
      max_restarts: 10,
      env: {
        HUMA_DISPLAY: ':99',
        HUMA_XVFB_SCREEN: '1920x1080x24',
      },
    },
    // x11vnc → systemd (huma-x11vnc.service). pm2 stdout 파이프 데드락 방지 + 재부팅 자동 기동.
    // 등록: sudo HUMA_USER=$USER bash apps/server/deploy/setup-x11vnc-systemd.sh
    {
      name: 'huma-server',
      cwd: serverRoot,
      script: 'dist/index.js',
      interpreter: 'node',
      autorestart: true,
      max_memory_restart: '2G',
      wait_ready: false,
      listen_timeout: 8000,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        DISPLAY: ':99',
        XVFB_AVAILABLE: 'true',
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
    },
  ],
};
