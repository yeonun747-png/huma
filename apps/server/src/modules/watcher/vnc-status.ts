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

/** vnc://100.x.x.x:5900 → 100.x.x.x:5900 */
function vncEndpointFromEnvUrl(vncUrl: string | null | undefined): string | null {
  const raw = vncUrl?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname || u.pathname.replace(/^\//, '').split('/')[0];
    if (!host) return null;
    return `${host}:${u.port || '5900'}`;
  } catch {
    const m = raw.match(/^vnc:\/\/([^/?#]+)/i);
    return m?.[1] ?? null;
  }
}

function isTailscaleIp(host: string): boolean {
  return host.startsWith('100.') || host.endsWith('.ts.net');
}

export async function getVncRuntimeStatus(): Promise<{
  port: number;
  display: string;
  listening: boolean;
  xvfb: boolean;
  x11vnc: boolean;
  drillActive: boolean;
  vncUrlYeonun: string | null;
  vncEndpoint: string | null;
  tailscale: boolean;
  hint: string;
}> {
  const port = Number(process.env.HUMA_VNC_PORT ?? 5900);
  const display = process.env.DISPLAY?.trim() || ':99';
  const listening = await checkTcpPort('127.0.0.1', port);
  const xvfb = hasLinuxProcess(`Xvfb ${display} `);
  const x11vnc = hasLinuxProcess(`x11vnc.*-display ${display}`);

  const vncUrlYeonun = process.env.HUMA_VNC_URL_YEONUN?.trim() || null;
  const endpoint = vncEndpointFromEnvUrl(vncUrlYeonun) ?? `172.30.1.96:${port}`;
  const host = endpoint.split(':')[0] ?? endpoint;
  const viaTailscale = isTailscaleIp(host);

  let hint: string;
  if (!xvfb) {
    hint = 'Xvfb 미실행 — pm2 restart huma-xvfb';
  } else if (!listening || !x11vnc) {
    hint = 'x11vnc 미기동 — sudo systemctl restart huma-x11vnc';
  } else if (viaTailscale) {
    hint = `5900 OK — ${endpoint} (Tailscale). 한글 CAPTCHA는 웹 큐 「CAPTCHA 정답 원격 입력」 권장(VNC 한/영 불필요).`;
  } else {
    hint = `5900 OK — ${endpoint} (LAN). 한글 CAPTCHA는 웹 큐 「CAPTCHA 정답 원격 입력」 권장(VNC 한/영 불필요).`;
  }

  return {
    port,
    display,
    listening,
    xvfb,
    x11vnc,
    drillActive: false,
    vncUrlYeonun,
    vncEndpoint: endpoint,
    tailscale: viaTailscale,
    hint,
  };
}
