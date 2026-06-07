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
      name: 'huma-x11vnc',
      script: path.join(deployRoot, 'scripts/run-x11vnc.sh'),
      interpreter: 'bash',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: '/dev/null',
      error_file: '/dev/null',
      env: {
        DISPLAY: ':99',
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
  ],
};
