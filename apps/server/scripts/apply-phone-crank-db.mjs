import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const patch = {
  modem_role: 'crank',
  carrier: 'phone',
  status: 'offline',
  interface_name: null,
  current_ip: null,
  public_ip: null,
  geo_region: null,
};

for (const slot of [6, 7]) {
  const proxy_port = 10000 + slot;
  const { error } = await supabase
    .from('huma_modems')
    .update({ ...patch, proxy_port })
    .eq('slot_number', slot);
  if (error) console.error(`slot ${slot}:`, error.message);
  else console.log(`slot ${slot}: ok`);
}

const { data } = await supabase
  .from('huma_modems')
  .select('slot_number,modem_role,carrier,status,proxy_port')
  .in('slot_number', [6, 7]);
console.log(JSON.stringify(data, null, 2));
