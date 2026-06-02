'use client';

import { cn } from '@/lib/constants';
import type { ReactNode } from 'react';

export function MGrid({ cols = 2, className, children }: { cols?: 1 | 2 | 3 | 4; className?: string; children: ReactNode }) {
  const cls = cols === 4 ? 'm-g4' : cols === 3 ? 'm-g3' : cols === 1 ? 'm-g1' : 'm-g2';
  return <div className={cn(cls, className)}>{children}</div>;
}

export function MPanel({ title, action, children, className }: { title: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn('m-panel', className)}>
      <div className="m-panel-t">
        {title}
        {action}
      </div>
      {children}
    </div>
  );
}

export function MStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'ok' | 'warn' | 'err' | 'blue';
}) {
  return (
    <div className="m-sc">
      <div className="m-sc-l">{label}</div>
      <div className={cn('m-sc-v', tone === 'ok' && 'ok', tone === 'warn' && 'warn', tone === 'err' && 'err', tone === 'blue' && 'blue')}>{value}</div>
      {sub !== undefined && <div className={cn('m-sc-s', typeof sub === 'string' && sub.includes('▲') && 'ok', typeof sub === 'string' && sub.includes('▼') && 'err')}>{sub}</div>}
    </div>
  );
}

export function MTag({ children, tone = 'idle' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'err' | 'idle' | 'live' | 'blue' }) {
  return <span className={cn('m-tag', `m-tag-${tone}`)}>{children}</span>;
}

export function MTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="m-tbl">
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function MToggle({ label, sub, sub2, value, onChange }: { label: string; sub?: string; sub2?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="m-tw">
      <div>
        <div className="m-tw-label">{label}</div>
        {sub && <div className="m-tw-sub">{sub}</div>}
        {sub2 && <div className="m-tw-sub">{sub2}</div>}
      </div>
      <button type="button" className={cn('m-tgl', value && 'on')} onClick={() => onChange(!value)} aria-pressed={value} />
    </div>
  );
}

export function MProgressStat({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max > 0 ? Math.round((current / max) * 100) : 0;
  return (
    <div className="m-sc">
      <div className="m-sc-l">{label}</div>
      <div className="m-sc-v">
        {current}
        <span className="text-[11px] text-huma-t3">/{max}</span>
      </div>
      <div className="mt-1">
        <div className="m-pb">
          <div className="m-pf" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

export function MSocRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="m-soc-row">
      <span className="m-soc-l">{label}</span>
      <span className="m-soc-v">{value}</span>
    </div>
  );
}

export function MUrlLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <span className="text-[10px] font-mono text-huma-t4">—</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="m-url-link">
      {children}
    </a>
  );
}

export function MQueueItem({
  icon,
  title,
  sub,
  tag,
  tagTone,
  onClick,
  onRun,
  onStop,
  onDelete,
}: {
  icon: string;
  title: string;
  sub: string;
  tag: string;
  tagTone: 'live' | 'warn' | 'idle';
  onClick?: () => void;
  onRun?: () => void;
  onStop?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={onClick ? 'm-qi m-qi-clickable' : 'm-qi'}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="m-qi-ico">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="m-qi-title">{title}</div>
        <div className="m-qi-sub">{sub}</div>
      </div>
      <div className="m-qi-r">
        <MTag tone={tagTone}>{tag}</MTag>
        <button
          type="button"
          className="m-q-btn run"
          title="지금 실행"
          onClick={(e) => {
            e.stopPropagation();
            onRun?.();
          }}
        >
          ▶
        </button>
        <button
          type="button"
          className="m-q-btn stop"
          title="일시정지"
          onClick={(e) => {
            e.stopPropagation();
            onStop?.();
          }}
        >
          ■
        </button>
        {onDelete ? (
          <button
            type="button"
            className="m-q-btn del"
            title="삭제"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MAccountCard({
  icon,
  iconBg,
  name,
  badge,
  url,
  status,
  statusTone,
  stats,
  actions,
}: {
  icon: string;
  iconBg: string;
  name: ReactNode;
  badge?: ReactNode;
  url: string;
  status: string;
  statusTone: 'ok' | 'warn' | 'err' | 'live' | 'idle';
  stats: { label: string; value: ReactNode; tone?: string }[];
  actions: { label: string; primary?: boolean; danger?: boolean; onClick?: () => void }[];
}) {
  return (
    <div className="m-ac">
      <div className="m-ac-top">
        <div className="m-ac-ico" style={{ background: iconBg }}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="m-ac-name">{name}</div>
          <div className="m-ac-url">{url}</div>
        </div>
        <MTag tone={statusTone}>{status}</MTag>
      </div>
      <div className="m-ac-stats">
        {stats.map((s) => (
          <div key={s.label} className="m-am">
            <div className="m-am-l">{s.label}</div>
            <div className={cn('m-am-v', s.tone)}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="m-ac-foot">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={cn('m-af', a.primary && 'e', a.danger && 'danger')}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MCrankRow({
  icon,
  title,
  sub,
  status,
  statusTone,
  onAction,
}: {
  icon: string;
  title: string;
  sub: string;
  status: string;
  statusTone: 'ok' | 'warn' | 'idle';
  onAction?: () => void;
}) {
  return (
    <div className="m-cr">
      <div className="m-cr-i">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="m-cr-t">{title}</div>
        <div className="m-cr-m">{sub}</div>
      </div>
      <button type="button" className={cn('m-cr-a', statusTone === 'ok' && 'r', statusTone === 'warn' && 'w')} onClick={onAction}>
        {status}
      </button>
    </div>
  );
}

export function MTypeBadge({ type }: { type: 'posting' | 'crank' | 'shared' }) {
  return <span className={cn('m-type-badge', type === 'posting' && 'posting', type === 'crank' && 'crank', type === 'shared' && 'shared')}>{type === 'posting' ? 'POSTING' : type === 'shared' ? '공유(퀴즈+파나나)' : 'C-RANK'}</span>;
}
