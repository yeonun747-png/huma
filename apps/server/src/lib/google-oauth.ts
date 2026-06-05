import { google } from 'googleapis';

const WORKSPACE_ENV_KEYS: Record<string, string> = {
  quizoasis: 'QUIZOASIS',
  yeonun: 'YEONUN',
  panana: 'PANANA',
};

export function googleEnvKey(workspace: string, suffix: string): string | undefined {
  const ws = WORKSPACE_ENV_KEYS[workspace];
  if (ws) {
    const specific = process.env[`ADSENSE_${suffix}_${ws}`]?.trim();
    if (specific) return specific;
    const gsc = process.env[`GSC_${suffix}_${ws}`]?.trim();
    if (gsc) return gsc;
  }
  return (
    process.env[`ADSENSE_${suffix}`]?.trim() ??
    process.env[`GOOGLE_ADSENSE_${suffix}`]?.trim() ??
    process.env[`GSC_${suffix}`]?.trim()
  );
}

export function getGoogleOAuth2(workspace: string) {
  const clientId = googleEnvKey(workspace, 'CLIENT_ID');
  const clientSecret = googleEnvKey(workspace, 'CLIENT_SECRET');
  const refreshToken = googleEnvKey(workspace, 'REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

export function gscSiteUrl(workspace: string): string | null {
  const ws = WORKSPACE_ENV_KEYS[workspace];
  const fromEnv =
    (ws ? process.env[`GSC_SITE_URL_${ws}`]?.trim() : undefined) ??
    process.env[`GSC_SITE_URL_${workspace.toUpperCase()}`]?.trim() ??
    process.env.GSC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`;

  const defaults: Record<string, string> = {
    yeonun: 'https://yeonun.com/',
    quizoasis: 'https://myquizoasis.com/',
    panana: 'https://panana.kr/',
  };
  return defaults[workspace] ?? null;
}
