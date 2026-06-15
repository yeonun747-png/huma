'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatLogKst, kstDateKey, logKstDateKey } from '@/lib/format-kst';
import { MGrid, MPanel, MStat, MTable, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

type LogRow = Record<string, unknown>;

function levelTag(level: string) {
  const l = level.toUpperCase();
  if (l === 'ERROR') return <MTag tone="err">실패</MTag>;
  if (l === 'WARN') return <MTag tone="warn">지연</MTag>;
  return <MTag tone="ok">성공</MTag>;
}

function accountLabel(row: LogRow): string {
  const crank = row.account_crank_label;
  const name = row.account_name;
  if (typeof crank === 'string' && crank.trim()) {
    return typeof name === 'string' && name.trim() ? `${crank} · ${name}` : crank;
  }
  if (typeof name === 'string' && name.trim()) return name;
  const id = row.account_id;
  if (typeof id === 'string' && id.length > 8) return `${id.slice(0, 8)}…`;
  return String(id ?? '—');
}

export function OplogView() {
  const [logs, setLogs] = useState<LogRow[]>([]);

  const load = useCallback(() => {
    api.logs({ limit: '50' }).then(setLogs).catch(() => setLogs([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRegisterPageAction('downloadOplog', async () => {
    const data = await api.logs({ limit: '500' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `huma-oplog-${kstDateKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const stats = useMemo(() => {
    const today = kstDateKey();
    const todayLogs = logs.filter((l) => {
      const created = String(l.created_at ?? '');
      if (!created) return false;
      return logKstDateKey(created) === today;
    });
    return {
      ok: todayLogs.filter((l) => String(l.level).toUpperCase() === 'INFO').length,
      err: todayLogs.filter((l) => String(l.level).toUpperCase() === 'ERROR').length,
      running: logs.filter((l) => String(l.message ?? '').includes('진행')).length,
    };
  }, [logs]);

  const rows = logs.map((l) => {
    const time = formatLogKst(String(l.created_at ?? ''));

    return [
      <span key="t" className="whitespace-nowrap font-mono text-[10.5px]">
        {time}
      </span>,
      accountLabel(l),
      String(l.message ?? '—').slice(0, 80),
      levelTag(String(l.level ?? 'INFO')),
    ];
  });

  return (
    <div className="animate-fadeIn">
      <MGrid cols={3}>
        <MStat label="오늘 성공" value={stats.ok} tone="ok" />
        <MStat label="오류" value={stats.err} tone="err" />
        <MStat label="진행중" value={stats.running} tone="blue" />
      </MGrid>
      <MPanel title="Operation Log · 오늘 전체 (KST)">
        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-huma-t3">로그가 없습니다</div>
        ) : (
          <MTable head={['시각 (KST)', '계정', '콘텐츠', '결과']} rows={rows} />
        )}
      </MPanel>
    </div>
  );
}
