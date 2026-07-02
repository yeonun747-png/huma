'use client';

import { useEffect, useState } from 'react';
import type { HumaModem } from '@huma/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';

export function ModemPanel() {
  const [modems, setModems] = useState<HumaModem[]>([]);

  useEffect(() => {
    api.modems({ probe: true }).then(setModems).catch(() => setModems([]));
  }, []);

  const STATUS: Record<string, string> = {
    idle: 'tag-ok',
    busy: 'tag-live',
    reconnecting: 'tag-warn',
    error: 'tag-err',
  };

  return (
    <div className="animate-fadeIn">
      <div className="panel-title">LTE 동글 · 3proxy</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {modems.length === 0 ? (
          <div className="col-span-full panel text-sm text-huma-t3">등록된 모뎀이 없습니다. Supabase huma_modems 테이블에 추가하세요.</div>
        ) : modems.map((m) => (
          <div key={m.id} className="stat-card">
            <div className="flex justify-between">
              <span className="stat-label">Slot {m.slot_number}</span>
              <span className={cn(STATUS[m.status] ?? 'tag-idle')}>{m.status}</span>
            </div>
            <div className="stat-value text-base">:{m.proxy_port}</div>
            <div className="font-mono text-[10.5px] text-huma-t3">
              {m.public_ip ?? m.current_ip ?? '—'}
              {m.geo_region ? ` · ${m.geo_region}` : ''}
            </div>
            <div className="font-mono text-[10.5px] text-huma-t3">{m.response_ms != null ? `${m.response_ms}ms` : '—'}</div>
            <button type="button" className="btn-ghost mt-2 w-full text-[10px]" onClick={() => api.reconnectModem(m.id).then(() => api.modems({ probe: true }).then(setModems))}>
              복구
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
