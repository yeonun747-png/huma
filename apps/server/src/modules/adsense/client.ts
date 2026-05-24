import { google } from 'googleapis';

const WORKSPACE_ENV_KEYS: Record<string, string> = {
  quizoasis: 'QUIZOASIS',
};

export interface AdSenseStats {
  configured: boolean;
  todayEarnings: number;
  yesterdayEarnings: number;
  monthEarnings: number;
  monthPageViews: number;
  rpm: number;
  unpaidBalance: number;
  unpaidBalanceFormatted: string;
  monthlyTrend: Array<{ month: string; earnings: number; pageViews: number; rpm: number }>;
}

function envKey(workspace: string, suffix: string): string | undefined {
  const ws = WORKSPACE_ENV_KEYS[workspace];
  if (ws) {
    const specific = process.env[`ADSENSE_${suffix}_${ws}`]?.trim();
    if (specific) return specific;
  }
  return process.env[`ADSENSE_${suffix}`]?.trim();
}

function getAdSenseClient(workspace: string) {
  const clientId = envKey(workspace, 'CLIENT_ID');
  const clientSecret = envKey(workspace, 'CLIENT_SECRET');
  const refreshToken = envKey(workspace, 'REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.adsense({ version: 'v2', auth: oauth2 });
}

function accountPath(workspace: string): string | null {
  const raw = envKey(workspace, 'ACCOUNT_ID') ?? envKey(workspace, 'PUBLISHER_ID');
  if (!raw) return null;
  return raw.startsWith('accounts/') ? raw : `accounts/${raw}`;
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMetric(rows: Array<{ cells?: Array<{ value?: string | null }> | null }> | null | undefined, index: number): number {
  let total = 0;
  for (const row of rows ?? []) {
    const val = row.cells?.[index]?.value;
    if (val != null && val !== '') total += Number(val);
  }
  return total;
}

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

async function fetchReport(
  adsense: ReturnType<typeof google.adsense>,
  account: string,
  params: {
    dateRange?: string;
    startDate?: { year: number; month: number; day: number };
    endDate?: { year: number; month: number; day: number };
    metrics: string[];
    dimensions?: string[];
  },
) {
  return adsense.accounts.reports.generate({
    account,
    dateRange: params.dateRange,
    'startDate.year': params.startDate?.year,
    'startDate.month': params.startDate?.month,
    'startDate.day': params.startDate?.day,
    'endDate.year': params.endDate?.year,
    'endDate.month': params.endDate?.month,
    'endDate.day': params.endDate?.day,
    metrics: params.metrics,
    dimensions: params.dimensions,
  });
}

export async function fetchAdSenseStats(workspace: string): Promise<AdSenseStats> {
  const empty: AdSenseStats = {
    configured: false,
    todayEarnings: 0,
    yesterdayEarnings: 0,
    monthEarnings: 0,
    monthPageViews: 0,
    rpm: 0,
    unpaidBalance: 0,
    unpaidBalanceFormatted: '',
    monthlyTrend: [],
  };

  const adsense = getAdSenseClient(workspace);
  const account = accountPath(workspace);
  if (!adsense || !account) return empty;

  const now = new Date();

  const trendStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const [todayRes, yesterdayRes, monthRes, trendRes, paymentsRes] = await Promise.all([
    fetchReport(adsense, account, {
      dateRange: 'TODAY',
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS'],
    }),
    fetchReport(adsense, account, {
      dateRange: 'YESTERDAY',
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS'],
    }),
    fetchReport(adsense, account, {
      dateRange: 'MONTH_TO_DATE',
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS'],
    }),
    fetchReport(adsense, account, {
      startDate: { year: trendStart.getFullYear(), month: trendStart.getMonth() + 1, day: 1 },
      endDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS'],
      dimensions: ['MONTH'],
    }),
    adsense.accounts.payments.list({ parent: account }),
  ]);

  const todayEarnings = parseMetric(todayRes.data.rows, 0);
  const yesterdayEarnings = parseMetric(yesterdayRes.data.rows, 0);
  const monthEarnings = parseMetric(monthRes.data.rows, 0);
  const monthPageViews = parseMetric(monthRes.data.rows, 1);
  const rpm = monthPageViews > 0 ? (monthEarnings / monthPageViews) * 1000 : 0;

  const unpaidPayment = paymentsRes.data.payments?.find((payment) => payment.name?.endsWith('/unpaid'));
  const unpaidBalanceFormatted = unpaidPayment?.amount ?? '';
  const unpaidBalance = parseAmount(unpaidBalanceFormatted);

  const monthlyTrend: AdSenseStats['monthlyTrend'] = [];
  for (const row of trendRes.data.rows ?? []) {
    const monthRaw = row.cells?.[0]?.value ?? '';
    const earnings = Number(row.cells?.[1]?.value ?? 0);
    const pageViews = Number(row.cells?.[2]?.value ?? 0);
    if (!monthRaw) continue;
    const [y, m] = monthRaw.split('-').map(Number);
    monthlyTrend.push({
      month: monthLabel(y, m),
      earnings,
      pageViews,
      rpm: pageViews > 0 ? (earnings / pageViews) * 1000 : 0,
    });
  }

  return {
    configured: true,
    todayEarnings,
    yesterdayEarnings,
    monthEarnings,
    monthPageViews,
    rpm,
    unpaidBalance,
    unpaidBalanceFormatted,
    monthlyTrend,
  };
}

export function isAdSenseConfigured(workspace: string): boolean {
  return Boolean(getAdSenseClient(workspace) && accountPath(workspace));
}
