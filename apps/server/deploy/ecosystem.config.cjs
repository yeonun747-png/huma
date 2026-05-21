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
      },
    },
    {
      name: 'huma-worker-b',
      cwd: serverRoot,
      script: 'dist/worker-only.js',
      interpreter: 'node',
      autorestart: true,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        DISPLAY: ':99',
        XVFB_AVAILABLE: 'true',
        HUMA_WORKER_CONCURRENCY: '3',
        // REDIS_HOST: '192.168.x.x',  // 노트북 A IP — .env 또는 pm2 env_file
      },
    },
  ],
};
