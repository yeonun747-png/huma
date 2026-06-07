import { execSync } from 'node:child_process';
import { createConnection } from 'node:net';

function checkTcpPort(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function hasLinuxProcess(pattern: string): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return execSync(`pgrep -f "${pattern}"`, { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

export async function getVncRuntimeStatus(): Promise<{
  port: number;
  display: string;
  listening: boolean;
  xvfb: boolean;
  x11vnc: boolean;
  drillActive: boolean;
  vncUrlYeonun: string | null;
  hint: string;
}> {
  const port = Number(process.env.HUMA_VNC_PORT ?? 5900);
  const display = process.env.DISPLAY?.trim() || ':99';
  const listening = await checkTcpPort('127.0.0.1', port);
  const xvfb = hasLinuxProcess(`Xvfb ${display} `);
  const x11vnc = hasLinuxProcess(`x11vnc.*-display ${display}`);

  let hint: string;
  if (!xvfb) {
    hint = 'Xvfb 미실행 — pm2 restart huma-xvfb';
  } else if (!listening || !x11vnc) {
    hint = 'x11vnc 미기동 — pm2 start deploy/ecosystem.config.cjs --only huma-x11vnc';
  } else {
    hint =
      '5900 LISTEN OK — RealVNC Viewer: 주소 172.30.1.96:5900 · Direct(Cloud 아님) · 암호 없음. 평소 검정=정상, DRILL 중 흰 화면.';
  }

  return {
    port,
    display,
    listening,
    xvfb,
    x11vnc,
    drillActive: false,
    vncUrlYeonun: process.env.HUMA_VNC_URL_YEONUN?.trim() || null,
    hint,
  };
}
