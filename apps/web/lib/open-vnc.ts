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

export async function copyVncEndpoint(endpoint: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(endpoint);
    return true;
  } catch {
    window.prompt('RealVNC Direct 주소 (복사 후 붙여넣기)', endpoint);
    return false;
  }
}
