import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';

type LogRow = Record<string, unknown> & {
  huma_accounts?: { name?: string; crank_label?: string | null } | null;
};

function flattenLogRow(row: LogRow) {
  const acct = row.huma_accounts;
  const { huma_accounts: _a, ...rest } = row;
  return {
    ...rest,
    account_name: acct?.name ?? null,
    account_crank_label: acct?.crank_label ?? null,
  };
}

export async function registerLogRoutes(app: FastifyInstance) {
  app.get('/api/logs', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { level, platform, from, to, limit = '100' } = request.query as {
      level?: string;
      platform?: string;
      from?: string;
      to?: string;
      limit?: string;
    };

    const wsFilter = allowedWorkspaces.map((w) => w.trim()).join(',');

    let query = supabase
      .from('huma_logs')
      .select('*, huma_accounts(name, crank_label)')
      .or(`workspace.in.(${wsFilter}),workspace.is.null`)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (level) query = query.eq('level', level);
    if (platform) query = query.eq('platform', platform);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data } = await query;
    return (data ?? []).map((row) => flattenLogRow(row as LogRow));
  });
}
