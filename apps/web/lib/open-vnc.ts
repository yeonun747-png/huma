import { appPrompt } from '@/lib/app-dialog';

/** vnc://172.30.1.96:5900 → 172.30.1.96:5900 (RealVNC Direct용) */
export function parseVncEndpoint(vncUrl: string): string | null {
  try {
    const u = new URL(vncUrl);
    const host = u.hostname || u.pathname.replace(/^\//, '').split('/')[0];
    if (!host) return null;
    return `${host}:${u.port || '5900'}`;
  } catch {
    const m = vncUrl.match(/^vnc:\/\/([^/?#]+)/i);
    return m?.[1] ?? null;
  }
}

/** Tailscale CGNAT 100.64.0.0/10 */
export function isTailscaleEndpoint(endpoint: string): boolean {
  const host = endpoint.split(':')[0]?.trim() ?? '';
  if (!host.startsWith('100.')) return false;
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

/** RealVNC Direct 주소 복사 실패 시 표시 */
export async function copyVncEndpoint(endpoint: string): Promise<boolean> {  try {
    await navigator.clipboard.writeText(endpoint);
    return true;
  } catch {
    await appPrompt('RealVNC Direct 주소 (복사 후 붙여넣기)', endpoint);
    return false;
  }
}
