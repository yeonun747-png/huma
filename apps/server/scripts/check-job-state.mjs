import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: modems } = await sb
  .from('huma_modems')
  .select('slot_number,status,modem_role,carrier')
  .in('slot_number', [6, 7]);
console.log('modems 6-7', modems);

const { data: adv } = await sb
  .from('huma_jobs')
  .select('id,status,job_type,error_message,scheduled_at,advance_requested_at,started_at')
  .not('advance_requested_at', 'is', null)
  .order('advance_requested_at', { ascending: false })
  .limit(3);
console.log('advanced', adv);

const { count: running } = await sb
  .from('huma_jobs')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'running');
console.log('running', running);

const { data: errs } = await sb
  .from('huma_jobs')
  .select('status,job_type,error_message')
  .not('error_message', 'is', null)
  .order('created_at', { ascending: false })
  .limit(6);
console.log('recent errors', errs);
