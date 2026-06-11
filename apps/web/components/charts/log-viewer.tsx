'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getLogSocket } from '@/lib/socket';
import { cn } from '@/lib/constants';
import { formatLogKstTime } from '@/lib/format-kst';

interface LogEntry {
  level: string;
  message: string;
  workspace?: string;
  platform?: string;
  result_url?: string;
  created_at: string;
}

const LEVEL_CLASS: Record<string, string> = {
  info: 'text-huma-ok',
  warn: 'text-huma-warn',
  ERROR: 'text-huma-err',
  error: 'text-huma-err',
};

export function LogViewer({ tall }: { tall?: boolean }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.logs({ limit: '100' }).then((data) => setLogs(data as unknown as LogEntry[])).catch(() => {});

    const socket = getLogSocket();
    socket.connect();
    socket.on('log', (entry: LogEntry) => {
      setLogs((prev) => [entry, ...prev].slice(0, 200));
    });
    return () => {
      socket.off('log');
    };
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [logs]);

  return (
    <div className={cn('overflow-y-auto rounded-lg border border-huma-bdr bg-black p-3 font-mono text-[10px] leading-relaxed', tall ? 'h-[380px]' : 'h-[200px]')} ref={ref}>
      {logs.length === 0 ? (
        <div className="text-huma-t3">로그 대기 중...</div>
      ) : (
        logs.map((log, i) => (
          <div key={`${log.created_at}-${i}`} className="mb-0.5">
            <span className="mr-2 text-[#5a7090]">{formatLogKstTime(log.created_at)}</span>
            <span className={LEVEL_CLASS[log.level] ?? 'text-[#7ca8c8]'}>[{log.level}]</span>
            <span className="ml-1 text-huma-t2">{log.message}</span>
            {log.result_url && <span className="ml-1 text-huma-acc">{log.result_url}</span>}
          </div>
        ))
      )}
    </div>
  );
}
