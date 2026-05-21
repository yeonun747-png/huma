'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HumaBgmLibrary } from '@huma/shared';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { MGrid, MPanel, MStat, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const MOODS = ['calm', 'emotional', 'dark', 'inspiring', 'upbeat'];

export function BgmLibraryView() {
  const { workspace } = useWorkspace();
  const [tracks, setTracks] = useState<HumaBgmLibrary[]>([]);
  const [allTracks, setAllTracks] = useState<HumaBgmLibrary[]>([]);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', mood: 'calm', file_url: '' });

  const load = useCallback(() => {
    api.bgmList().then((all) => {
      setAllTracks(all);
      setTracks(all.filter((t) => t.workspace_fit.includes(workspace)));
    }).catch(() => {});
  }, [workspace]);

  useEffect(() => { load(); }, [load]);
  useRegisterPageAction('openBgmForm', () => setShowForm(true));

  const counts = useMemo(() => ({
    total: allTracks.length,
    yeonun: allTracks.filter((t) => t.workspace_fit.includes('yeonun')).length,
    quizoasis: allTracks.filter((t) => t.workspace_fit.includes('quizoasis')).length,
    panana: allTracks.filter((t) => t.workspace_fit.includes('panana')).length,
  }), [allTracks]);

  const filtered = filter === 'all' ? tracks : tracks.filter((t) => t.mood.includes(filter));

  const handleCreate = async () => {
    if (!form.title || !form.file_url) return;
    await api.createBgm({ workspace_fit: [workspace], title: form.title, mood: [form.mood], genre: ['ambient'], file_url: form.file_url, duration_sec: 60 });
    setShowForm(false);
    load();
  };

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MStat label="총" value={counts.total} />
        <MStat label="연운" value={counts.yeonun} />
        <MStat label="퀴즈" value={counts.quizoasis} />
        <MStat label="파나나" value={counts.panana} />
      </MGrid>
      <MGrid cols={2}>
        <MPanel title="BGM 라이브러리">
          <div className="mb-3 flex flex-wrap gap-1">
            {['all', ...MOODS].map((m) => (
              <button key={m} type="button" className={`rounded px-2 py-0.5 text-[10px] ${filter === m ? 'bg-huma-acc text-white' : 'bg-huma-bg3 text-huma-t2'}`} onClick={() => setFilter(m)}>
                {m === 'all' ? '전체' : m}
              </button>
            ))}
          </div>
          {filtered.map((t) => (
            <div key={t.id} className="mb-2 flex items-center gap-2 rounded-md border border-huma-bdr2 bg-huma-bg3 px-3 py-2">
              <button type="button" className="text-sm">▶</button>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-huma-t">{t.title}</div>
                <div className="font-mono text-[10.5px] text-huma-t3">{t.mood.join(', ')} · {t.use_count}회 사용</div>
              </div>
              <MTag tone="idle">{t.workspace_fit.join(', ')}</MTag>
            </div>
          ))}
        </MPanel>
        <MPanel title="음원 등록">
          {showForm ? (
            <div className="space-y-2">
              <input placeholder="제목" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="m-model-select" />
              <select value={form.mood} onChange={(e) => setForm((f) => ({ ...f, mood: e.target.value }))} className="m-model-select">
                {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input placeholder="Supabase Storage URL" value={form.file_url} onChange={(e) => setForm((f) => ({ ...f, file_url: e.target.value }))} className="m-model-select" />
              <button type="button" className="btn-primary w-full" onClick={handleCreate}>Supabase Storage에 등록</button>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-huma-bdr py-12 text-center text-sm text-huma-t3">
              파일을 드래그하거나 상단 + 음원 추가
            </div>
          )}
        </MPanel>
      </MGrid>
    </div>
  );
}
