/**
 * 포스팅 워밍업 일차 보정 진단 (+ --reconcile 로 DB 보정 시도)
 * node apps/server/scripts/probe-posting-warmup-day.mjs
 * node apps/server/scripts/probe-posting-warmup-day.mjs --reconcile
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const reconcile = process.argv.includes('--reconcile');
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

function jobKstDate(job) {
  const ps = job.platform_schedule ?? {};
  const pick = ps._publish_scheduled_at || job.scheduled_at || job.completed_at;
  return kstDateKey(pick);
}

function isAutoPublishJob(ps) {
  return ps && typeof ps === 'object' && ps._auto_publish === true;
}

async function inferStartedKst(accountId, autoPublishEnabled) {
  const { data: acc } = await supabase
    .from('huma_accounts')
    .select('posting_warmup_started_kst')
    .eq('id', accountId)
    .maybeSingle();

  if (acc?.posting_warmup_started_kst) return acc.posting_warmup_started_kst;

  const { data: firstAuto } = await supabase
    .from('huma_accounts')
    .select('id')
    .eq('id', accountId)
    .maybeSingle();

  if (!firstAuto) return null;

  const { data: firstContent } = await supabase
    .from('huma_jobs')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('job_type', 'content_full')
    .contains('platform_schedule', { _auto_publish: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (firstContent?.created_at) return kstDateKey(firstContent.created_at);

  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('completed_at, scheduled_at, platform_schedule, result_url')
    .eq('account_id', accountId)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null)
    .order('completed_at', { ascending: true })
    .limit(50);

  for (const job of jobs ?? []) {
    if (autoPublishEnabled && !isAutoPublishJob(job.platform_schedule)) continue;
    const k = jobKstDate(job);
    if (k) return k;
  }
  return null;
}

async function countWarmupDays(accountId, autoPublishEnabled) {
  const startedKst = await inferStartedKst(accountId, autoPublishEnabled);
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('completed_at, scheduled_at, platform_schedule, result_url')
    .eq('account_id', accountId)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null);

  const flagged = (jobs ?? []).filter((j) => isAutoPublishJob(j.platform_schedule));
  const pool = autoPublishEnabled && flagged.length ? flagged : jobs ?? [];
  const kstDates = new Set();
  for (const job of pool) {
    const k = jobKstDate(job);
    if (!k) continue;
    if (startedKst && k < startedKst) continue;
    kstDates.add(k);
  }
  return { startedKst, distinctDays: Math.min(30, kstDates.size), kstDates: [...kstDates].sort() };
}

console.log('KST today:', kstDateKey(new Date()), reconcile ? '(reconcile ON)' : '', '\n');

for (const slot of SLOTS) {
  const { data: acc, error: accErr } = await supabase
    .from('huma_accounts')
    .select(
      'id, slot_label, warmup_day, warmup_last_increment_date, auto_publish_enabled, posting_warmup_started_kst',
    )
    .eq('workspace', slot.workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .eq('proxy_port', slot.proxy_port)
    .maybeSingle();

  if (accErr?.message?.includes('posting_warmup_started_kst')) {
    console.log('⚠ posting_warmup_started_kst 컬럼 없음 — v3_67_posting_warmup_started.sql 실행 필요\n');
    break;
  }

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

  const { count: autoJobCount } = await supabase
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .contains('platform_schedule', { _auto_publish: true });

  const { count: autoContentCount } = await supabase
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', acc.id)
    .eq('job_type', 'content_full')
    .contains('platform_schedule', { _auto_publish: true });

  const warmup = await countWarmupDays(acc.id, Boolean(acc.auto_publish_enabled));

  console.log(`[${acc.slot_label ?? slot.label}] id=${acc.id.slice(0, 8)}… warmup_day=${acc.warmup_day}`);
  console.log(`  auto_publish=${acc.auto_publish_enabled} started_kst=${acc.posting_warmup_started_kst ?? warmup.startedKst ?? '—'}`);
  console.log(`  post_blog completed: ${jobCount ?? 0} · _auto_publish tagged: ${autoJobCount ?? 0}`);
  console.log(`  content_full _auto_publish: ${autoContentCount ?? 0}`);
  console.log(`  warmup distinct days (scoped): ${warmup.distinctDays}`);
  if (warmup.kstDates.length) console.log(`  scoped KST dates: ${warmup.kstDates.join(', ')}`);

  if (reconcile && warmup.distinctDays > (acc.warmup_day ?? 0)) {
    const patch = { warmup_day: warmup.distinctDays };
    if (warmup.kstDates.includes(kstDateKey(new Date()))) {
      patch.warmup_last_increment_date = kstDateKey(new Date());
    }
    if (!acc.posting_warmup_started_kst && warmup.startedKst) {
      patch.posting_warmup_started_kst = warmup.startedKst;
    }
    const { error: updErr } = await supabase.from('huma_accounts').update(patch).eq('id', acc.id);
    console.log(updErr ? `  reconcile FAILED: ${updErr.message}` : `  reconcile OK → warmup_day=${warmup.distinctDays}`);
  }
  console.log('');
}
