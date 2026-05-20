'use client';

import { useEffect, useState } from 'react';
import type { HumaAccount } from '@huma/shared';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { cn } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AccountList() {
  const { workspace } = useWorkspace();
  const [accounts, setAccounts] = useState<HumaAccount[]>([]);
  const [form, setForm] = useState({ name: '', naver_id: '', naver_pw: '', account_type: 'blog' });
  const [loading, setLoading] = useState(false);

  const load = () => {
    api.accounts().then((all) => setAccounts(all.filter((a) => a.workspace === workspace))).catch(() => setAccounts([]));
  };

  useEffect(() => { load(); }, [workspace]);

  const handleCreate = async () => {
    if (!form.name || !form.naver_id) return;
    setLoading(true);
    try {
      await api.createAccount({ ...form, workspace, is_active: true, health_score: 100, blog_index: 0, wpm: 45 });
      setForm({ name: '', naver_id: '', naver_pw: '', account_type: 'blog' });
      load();
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    await api.updateAccount(id, { is_active: !is_active });
    load();
  };

  return (
    <div className="animate-fadeIn space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>계정 추가 · {workspace}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <Input placeholder="표시 이름" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="max-w-[140px]" />
          <Input placeholder="네이버 ID" value={form.naver_id} onChange={(e) => setForm((f) => ({ ...f, naver_id: e.target.value }))} className="max-w-[140px]" />
          <Input type="password" placeholder="비밀번호" value={form.naver_pw} onChange={(e) => setForm((f) => ({ ...f, naver_pw: e.target.value }))} className="max-w-[140px]" />
          <select
            value={form.account_type}
            onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))}
            className="h-9 rounded-md border border-huma-bdr bg-huma-bg3 px-2 text-xs text-huma-t"
          >
            <option value="blog">blog</option>
            <option value="cafe">cafe</option>
            <option value="crank">crank</option>
          </select>
          <Button onClick={handleCreate} disabled={loading}>추가</Button>
        </CardContent>
      </Card>

      <div className="panel-title">계정 관리 · {workspace}</div>
      {accounts.length === 0 ? (
        <div className="panel text-sm text-huma-t3">등록된 계정이 없습니다.</div>
      ) : (
        accounts.map((ac) => (
          <div key={ac.id} className="rounded-lg border border-huma-bdr bg-huma-bg3 p-3 hover:border-huma-acc">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--ok-bg)] text-xs">📝</div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-huma-t">
                  {ac.name}
                  <span className="ml-2 rounded bg-huma-bg2 px-1.5 py-px font-mono text-[8px] uppercase text-huma-acc">{ac.account_type}</span>
                </div>
                <div className="font-mono text-[9.5px] text-huma-t3">{ac.blog_url ?? ac.naver_id}</div>
              </div>
              <span className={cn(ac.is_active ? 'tag-ok' : 'tag-err')}>{ac.is_active ? 'ACTIVE' : 'PAUSED'}</span>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(ac.id, ac.is_active)}>
                {ac.is_active ? '정지' : '활성화'}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded bg-huma-bg2 p-1.5"><div className="stat-label">Health</div><div className={cn('text-xs font-semibold', ac.health_score >= 80 ? 'text-huma-ok' : 'text-huma-warn')}>{ac.health_score}</div></div>
              <div className="rounded bg-huma-bg2 p-1.5"><div className="stat-label">Index</div><div className="text-xs font-semibold">{ac.blog_index}</div></div>
              <div className="rounded bg-huma-bg2 p-1.5"><div className="stat-label">오늘 발행</div><div className="text-xs font-semibold">{ac.post_count_today}</div></div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
