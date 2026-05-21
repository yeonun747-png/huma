'use client';



import { useEffect, useState } from 'react';

import type { HumaBgmLibrary } from '@huma/shared';

import { api } from '@/lib/api';

import { useWorkspace } from '@/components/dashboard/workspace-context';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';



export function BgmLibraryPanel() {

  const { workspace } = useWorkspace();

  const [tracks, setTracks] = useState<HumaBgmLibrary[]>([]);

  const [form, setForm] = useState({ title: '', mood: 'calm', genre: 'ambient', file_url: '' });

  const [loading, setLoading] = useState(false);



  const load = () => {

    api.bgmList({ workspace }).then(setTracks).catch(() => setTracks([]));

  };



  useEffect(() => { load(); }, [workspace]);



  const handleCreate = async () => {

    if (!form.title || !form.file_url) return;

    setLoading(true);

    try {

      await api.createBgm({

        workspace,

        title: form.title,

        mood: [form.mood],

        genre: [form.genre],

        file_url: form.file_url,

        duration_sec: 60,

      });

      setForm({ title: '', mood: 'calm', genre: 'ambient', file_url: '' });

      load();

    } finally {

      setLoading(false);

    }

  };



  return (

    <div className="animate-fadeIn space-y-4">

      <Card>

        <CardHeader>

          <CardTitle>BGM 추가 · {workspace}</CardTitle>

        </CardHeader>

        <CardContent className="flex flex-wrap items-end gap-2">

          <Input placeholder="제목" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="max-w-[160px]" />

          <Input placeholder="무드" value={form.mood} onChange={(e) => setForm((f) => ({ ...f, mood: e.target.value }))} className="max-w-[100px]" />

          <Input placeholder="장르" value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))} className="max-w-[100px]" />

          <Input placeholder="파일 URL" value={form.file_url} onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))} className="max-w-[240px]" />

          <Button onClick={handleCreate} disabled={loading}>추가</Button>

        </CardContent>

      </Card>



      <div className="panel">

        <div className="panel-title">BGM 라이브러리 · {workspace}</div>

        <Table>

          <TableHeader>

            <TableRow>

              <TableHead>제목</TableHead>

              <TableHead>무드</TableHead>

              <TableHead>장르</TableHead>

              <TableHead>길이</TableHead>

              <TableHead>사용</TableHead>

            </TableRow>

          </TableHeader>

          <TableBody>

            {tracks.length === 0 ? (

              <TableRow><TableCell colSpan={5} className="text-center text-huma-t3">등록된 BGM이 없습니다</TableCell></TableRow>

            ) : tracks.map((t) => (

              <TableRow key={t.id}>

                <TableCell className="text-huma-t">{t.title}</TableCell>

                <TableCell className="font-mono text-[10px]">{t.mood.join(', ')}</TableCell>

                <TableCell>{t.genre.join(', ')}</TableCell>

                <TableCell className="font-mono">{t.duration_sec}s</TableCell>

                <TableCell className="font-mono">{t.use_count}</TableCell>

              </TableRow>

            ))}

          </TableBody>

        </Table>

      </div>

    </div>

  );

}

