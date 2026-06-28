/**
 * 포스팅 워밍업 일차 보정 진단
 * node apps/server/scripts/probe-posting-warmup-day.mjs
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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const SLOTS = [
  { label: '연운1', workspace: 'yeonun', proxy_port: 10001 },
  { label: '연운2', workspace: 'yeonun', proxy_port: 10002 },
  { label: '연운3', workspace: 'yeonun', proxy_port: 10003 },
  { label: '파나나', workspace: 'panana', proxy_port: 10004 },
  { label: '퀴즈오아시스', workspace: 'quizoasis', proxy_port: 10005 },
];

function kstDateKey(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));
}

console.log('KST today:', kstDateKey(new Date()), '\n');

for (const slot of SLOTS) {
  const { data: acc } = await supabase
    .from('huma_accounts')
    .select('id, slot_label, warmup_day, warmup_last_increment_date')
    .eq('workspace', slot.workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .eq('proxy_port', slot.proxy_port)
    .maybeSingle();

  if (!acc?.id) {
    console.log(`[${slot.label}] 계정 없음 (proxy ${slot.proxy_port})`);
    continue;
  }

  const { count: jobCount } = await supabase
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null);

  const { data: jobsNoAccount } = await supabase
    .from('huma_jobs')
    .select('id, completed_at, result_url')
    .eq('workspace', slot.workspace)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .is('account_id', null)
    .limit(3);

  const { data: posts } = await supabase
    .from('posts')
    .select('published_at, post_url')
    .eq('account_id', acc.id);

  const postKstDates = new Set(
    (posts ?? [])
      .map((p) => kstDateKey(p.published_at))
      .filter(Boolean),
  );

  const { data: sampleJobs } = await supabase
    .from('huma_jobs')
    .select('id, completed_at, scheduled_at, platform_schedule, result_url')
    .eq('account_id', acc.id)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(3);

  console.log(`[${acc.slot_label ?? slot.label}] id=${acc.id.slice(0, 8)}… warmup_day=${acc.warmup_day}`);
  console.log(`  post_blog(completed+account_id): ${jobCount ?? 0}`);
  console.log(`  posts rows: ${posts?.length ?? 0} · distinct KST days: ${postKstDates.size}`);
  if (postKstDates.size) console.log(`  post KST dates: ${[...postKstDates].sort().join(', ')}`);
  if (jobsNoAccount?.length) {
    console.log(`  ⚠ workspace ${slot.workspace} completed post_blog with NULL account_id: ${jobsNoAccount.length}+`);
  }
  for (const j of sampleJobs ?? []) {
    const ps = j.platform_schedule ?? {};
    console.log(
      `  job ${j.id.slice(0, 8)} completed=${j.completed_at} publish_scheduled=${ps._publish_scheduled_at ?? '—'}`,
    );
  }
  console.log('');
}
