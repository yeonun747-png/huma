/**
 * 연운 due 차단 원인 — i7에서 실행
 * node -r dotenv/config scripts/probe-yeonun-due-block.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const kstToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const sinceIso = `${kstToday}T00:00:00+09:00`;

const { data: accounts } = await sb
  .from('huma_accounts')
  .select(
    'id, slot_label, proxy_port, warmup_day, auto_publish_enabled, auto_publish_planned_count, auto_publish_next_slot_at, auto_publish_kst_date, posting_reserved_today, posting_reserved_kst_date',
  )
  .eq('workspace', 'yeonun')
  .eq('account_type', 'posting')
  .in('proxy_port', [10001, 10002, 10003])
  .order('proxy_port');

console.log('KST', kstToday, '\n');

const { data: logs } = await sb
  .from('huma_logs')
  .select('message, created_at, account_id')
  .eq('workspace', 'yeonun')
  .ilike('message', '%auto-publish%')
  .gte('created_at', new Date(Date.now() - 3 * 3600_000).toISOString())
  .order('created_at', { ascending: false })
  .limit(40);

console.log('=== recent auto-publish logs ===');
for (const l of logs ?? []) {
  const acc = accounts?.find((a) => a.id === l.account_id);
  console.log(l.created_at?.slice(11, 19), acc?.slot_label ?? '?', l.message?.slice(0, 200));
}

for (const acc of accounts ?? []) {
  const label = acc.slot_label || acc.proxy_port;
  const { count: contentInflight } = await sb
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id)
    .eq('job_type', 'content_full')
    .in('status', ['pending', 'scheduled', 'running'])
    .gte('created_at', sinceIso);

  const { count: blogInflight } = await sb
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id)
    .eq('job_type', 'post_blog')
    .in('status', ['pending', 'scheduled', 'running', 'awaiting_captcha'])
    .gte('created_at', sinceIso);

  const { data: completedToday } = await sb
    .from('huma_jobs')
    .select('id, title, status, completed_at, platform_schedule')
    .eq('account_id', acc.id)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .gte('completed_at', sinceIso);

  const reserved =
    acc.posting_reserved_kst_date === kstToday ? acc.posting_reserved_today : 0;

  console.log(`\n=== ${label} ===`);
  console.log('  auto ON:', acc.auto_publish_enabled);
  console.log('  next_slot:', acc.auto_publish_next_slot_at);
  console.log('  planned:', acc.auto_publish_planned_count, 'warmup_day:', acc.warmup_day);
  console.log('  reserved:', reserved);
  console.log('  in_flight: content=', contentInflight, 'blog=', blogInflight);
  console.log('  post_blog completed today (completed_at):', completedToday?.length ?? 0);
  for (const j of completedToday ?? []) {
    const ps = j.platform_schedule ?? {};
    console.log('   -', j.title?.slice(0, 40), j.completed_at?.slice(11, 19), 'reconcile=', ps._reconciled_from_failed);
  }

  const { data: peerBlogs } = await sb
    .from('huma_jobs')
    .select('account_id, scheduled_at, status, title')
    .eq('job_type', 'post_blog')
    .in('status', ['pending', 'scheduled', 'running', 'awaiting_captcha'])
    .gte('scheduled_at', sinceIso)
    .order('scheduled_at', { ascending: true })
    .limit(10);

  if (label === '연운3') {
    console.log('  peer post_blog scheduled today:');
    for (const j of peerBlogs ?? []) {
      const peer = accounts?.find((a) => a.id === j.account_id);
      if (peer?.id === acc.id) continue;
      console.log('   ', peer?.slot_label, j.scheduled_at?.slice(11, 19), j.status, j.title?.slice(0, 30));
    }
  }
}
