'use client';

import { useEffect, useState } from 'react';
import { formatKstDate } from '@/lib/format-kst';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/constants';

type PlatformAccount = {
  id: string;
  workspace: string;
  platform: string;
  username: string;
  is_active: boolean;
  post_count_today: number;
  token_expires_at?: string;
};

const PLATFORMS = ['tiktok', 'instagram', 'threads', 'twitter'];

function PlatformAccountsContent() {
  const { workspace } = useWorkspace();
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [form, setForm] = useState({ platform: 'tiktok', username: '', access_token: '' });
  const [loading, setLoading] = useState(false);

  const load = () => {
    api.platformAccounts().then((all) => {
      setAccounts(all.filter((a) => a.workspace === workspace) as PlatformAccount[]);
    }).catch(() => setAccounts([]));
  };

  useEffect(() => { load(); }, [workspace]);

  const handleCreate = async () => {
    if (!form.username || !form.access_token) return;
    setLoading(true);
    try {
      await api.createPlatformAccount({
        workspace,
        platform: form.platform,
        username: form.username,
        access_token: form.access_token,
        is_active: true,
      });
      setForm({ platform: 'tiktok', username: '', access_token: '' });
      load();
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    await api.updatePlatformAccount(id, { is_active: !is_active });
    load();
  };

  return (
    <div className="animate-fadeIn space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>플랫폼 계정 추가 · {workspace}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <select
            value={form.platform}
            onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
            className="h-9 rounded-md border border-huma-bdr bg-huma-bg3 px-2 text-xs text-huma-t"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <Input placeholder="사용자명" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className="max-w-[160px]" />
          <Input placeholder="Access Token" value={form.access_token} onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))} className="max-w-[280px]" />
          <Button onClick={handleCreate} disabled={loading}>추가</Button>
        </CardContent>
      </Card>

      <div className="panel">
        <div className="panel-title">등록된 플랫폼 계정</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>플랫폼</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>오늘 발행</TableHead>
              <TableHead>토큰 만료</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-huma-t3">등록된 계정 없음</TableCell>
              </TableRow>
            ) : accounts.map((ac) => (
              <TableRow key={ac.id}>
                <TableCell className="uppercase">{ac.platform}</TableCell>
                <TableCell>{ac.username}</TableCell>
                <TableCell className="font-mono">{ac.post_count_today}</TableCell>
                <TableCell className="font-mono text-[10px]">
                  {ac.token_expires_at ? formatKstDate(ac.token_expires_at) : '—'}
                </TableCell>
                <TableCell>
                  <span className={cn(ac.is_active ? 'tag-ok' : 'tag-err')}>
                    {ac.is_active ? 'ACTIVE' : 'PAUSED'}
                  </span>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(ac.id, ac.is_active)}>
                    {ac.is_active ? '정지' : '활성화'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function PlatformAccountsPage() {
  return (
    <PlatformAccountsContent />
  );
}
