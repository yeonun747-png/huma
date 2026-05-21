'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { WORKSPACES } from '@/lib/constants';
import { MGrid, MPanel, MStat, MTable, MTag, MUrlLink } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

type LogRow = Record<string, unknown>;

function levelTag(level: string) {
  const l = level.toUpperCase();
  if (l === 'ERROR') return <MTag tone="err">실패</MTag>;
  if (l === 'WARN') return <MTag tone="warn">지연</MTag>;
  return <MTag tone="ok">성공</MTag>;
}

export function OplogView() {
  const [logs, setLogs] = useState<LogRow[]>([]);

  const load = useCallback(() => {
    api.logs({ limit: '50' }).then(setLogs).catch(() => setLogs([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  useRegisterPageAction('downloadOplog', async () => {
    const data = await api.logs({ limit: '500' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `huma-oplog-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayLogs = logs.filter((l) => String(l.created_at ?? '').startsWith(today));
    return {
      ok: todayLogs.filter((l) => String(l.level).toUpperCase() === 'INFO').length,
      err: todayLogs.filter((l) => String(l.level).toUpperCase() === 'ERROR').length,
      running: logs.filter((l) => String(l.message ?? '').includes('진행')).length,
    };
  }, [logs]);

  const rows = logs.map((l) => {
    const ws = WORKSPACES.find((w) => w.id === l.workspace)?.short ?? String(l.workspace ?? '—');
    const time = String(l.created_at ?? '').slice(11, 16) || '—';
    return [
      <span key="t" className="font-mono">{time}</span>,
      ws,
      String(l.account_name ?? l.account_id ?? '—'),
      String(l.message ?? '—').slice(0, 40),
      String(l.platform ?? '—'),
      levelTag(String(l.level ?? 'INFO')),
      l.url ? <MUrlLink href={String(l.url)}>{String(l.url).slice(0, 28)} ↗</MUrlLink> : <span className="font-mono text-[10px] text-huma-t3">{String(l.detail ?? '—')}</span>,
    ];
  });

  return (
    <div className="animate-fadeIn">
      <MGrid cols={3}>
        <MStat label="오늘 성공" value={stats.ok} tone="ok" />
        <MStat label="오류" value={stats.err} tone="err" />
        <MStat label="진행중" value={stats.running} tone="blue" />
      </MGrid>
      <MPanel title="Operation Log · 오늘 전체">
        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-huma-t3">로그가 없습니다</div>
        ) : (
          <MTable head={['시각', '서비스', '계정', '콘텐츠', '플랫폼', '결과', 'URL / 비고']} rows={rows} />
        )}
      </MPanel>
    </div>
  );
}
