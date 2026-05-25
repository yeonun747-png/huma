'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { MGrid, MPanel, MTable, MTag, MToggle } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

export function CafeViralView() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [cafes, setCafes] = useState<Array<Record<string, unknown>>>([]);
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [form, setForm] = useState({ cafe_url: '', cafe_name: '', keywords: '' });

  const [activityStats, setActivityStats] = useState<{ daily_reply: number; self_qa: number } | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.getSetting('cafe_viral').catch(() => ({})),
      api.cafeViralCafes(),
      api.cafeViralPosts(),
    ]).then(async ([cfg, c, p]) => {
      setConfig(cfg as Record<string, unknown>);
      setCafes(c);
      setPosts(p);
      const target = (c as Array<Record<string, unknown>>).find((x) => x.workspace === workspace && x.is_active !== false);
      if (target?.id) {
        api.cafeViralActivityStats(String(target.id)).then((s) => setActivityStats(s.today)).catch(() => setActivityStats(null));
      } else {
        setActivityStats(null);
      }
    }).catch(() => {
      setConfig({});
      setCafes([]);
      setPosts([]);
      setActivityStats(null);
    });
  }, [workspace]);

  useEffect(() => { load(); }, [load]);

  useRegisterPageAction('scanCafeViral', async () => {
    const target = cafes.find((c) => c.workspace === workspace && c.is_active !== false);
    if (!target?.id) {
      alert('활성 타겟 카페를 먼저 등록하세요.');
      return;
    }
    await api.scanCafeViral(String(target.id));
    load();
  });

  const saveCfg = async (patch: Record<string, unknown>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    await api.updateSetting('cafe_viral', next);
  };

  const addCafe = async () => {
    if (!form.cafe_url.trim()) return;
    await api.createCafeViral({
      workspace,
      cafe_url: form.cafe_url.trim(),
      cafe_name: form.cafe_name.trim() || form.cafe_url.trim(),
      keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    });
    setForm({ cafe_url: '', cafe_name: '', keywords: '' });
    load();
  };

  const cafeRows = cafes
    .filter((c) => c.workspace === workspace)
    .map((c) => [
      String(c.cafe_name ?? c.cafe_url),
      String(c.category ?? '—'),
      Array.isArray(c.keywords) ? (c.keywords as string[]).slice(0, 3).join(', ') : '—',
      c.grade_auto_detected ? '자동' : '수동',
      <MTag key="s" tone={c.is_active === false ? 'idle' : 'ok'}>{c.is_active === false ? '비활성' : '활성'}</MTag>,
    ]);

  const postRows = posts
    .filter((p) => p.workspace === workspace)
    .slice(0, 20)
    .map((p) => [
      String(p.post_title ?? '—').slice(0, 40),
      Array.isArray(p.keyword_matched) ? (p.keyword_matched as string[]).join(', ') : '—',
      <MTag key="st" tone={p.status === 'posted' ? 'ok' : p.status === 'failed' ? 'err' : 'idle'}>{String(p.status ?? 'pending')}</MTag>,
      <button
        key="btn"
        type="button"
        className="btn-ghost text-[10px]"
        disabled={p.status === 'posted'}
        onClick={() => api.replyCafeViralPost(String(p.id)).then(load)}
      >
        답글 실행
      </button>,
    ]);

  const perCafe = Number(config.daily_limit_per_cafe ?? 3);
  const total = Number(config.daily_limit_total ?? 10);
  const ratio = (config.activity_ratio as { daily_reply?: number; self_qa?: number }) ?? { daily_reply: 8, self_qa: 2 };
  const replyTarget = Number(ratio.daily_reply ?? 8);
  const selfTarget = Number(ratio.self_qa ?? 2);

  return (
    <div className="animate-fadeIn">
      <MGrid cols={2}>
        <MPanel title="타겟 카페 등록">
          <div className="space-y-2 text-sm">
            <input
              className="w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-xs"
              placeholder="카페 URL (예: wgang)"
              value={form.cafe_url}
              onChange={(e) => setForm((f) => ({ ...f, cafe_url: e.target.value }))}
            />
            <input
              className="w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-xs"
              placeholder="카페명"
              value={form.cafe_name}
              onChange={(e) => setForm((f) => ({ ...f, cafe_name: e.target.value }))}
            />
            <input
              className="w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-xs"
              placeholder="키워드 (쉼표 구분: 신점,사주,운세)"
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
            />
            <button type="button" className="btn-primary w-full py-2 text-xs" onClick={addCafe}>
              카페 등록
            </button>
          </div>
          {cafeRows.length ? (
            <div className="mt-3">
              <MTable head={['카페', '카테고리', '키워드', '등업조건', '상태']} rows={cafeRows} />
            </div>
          ) : (
            <EmptyPanel message="등록된 타겟 카페가 없습니다." />
          )}
        </MPanel>

        <MPanel title="바이럴 설정 (v3.17)">
          <MToggle
            label="카페 침투 바이럴"
            sub="검색 유입 게시글 자동 수집·답글"
            value={Boolean(config.enabled ?? true)}
            onChange={(v) => saveCfg({ enabled: v })}
          />
          <MToggle
            label="자문자답 (Self Q&A)"
            sub={`지연 ${Number(config.self_qa_delay_min ?? 60)}분 · 서비스명 노출 금지`}
            value={Boolean(config.self_qa_enabled ?? true)}
            onChange={(v) => saveCfg({ self_qa_enabled: v })}
          />
          <div className="mt-2 font-mono text-[10.5px] text-huma-t3">
            등업 후 활동 비율 (㉝): 타인 답글 {replyTarget} · 자문자답 {selfTarget} (80:20)
          </div>
          {activityStats && (
            <div className="mt-1 font-mono text-[10.5px] text-huma-t3">
              오늘 진행: 답글 {activityStats.daily_reply}/{replyTarget} · 자문자답 {activityStats.self_qa}/{selfTarget}
            </div>
          )}
          <div className="mt-2 font-mono text-[10.5px] text-huma-t3">
            일일 한도: 카페당 {perCafe}건 · 전체 {total}건 (㉛)
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-huma-t3">
            답글 스타일: {String(config.reply_style ?? '경험담 공감형')}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-huma-t3">
            ※ 가입(CAPTCHA)은 수동 · HUMA는 등업 워밍업부터 담당
          </div>
        </MPanel>
      </MGrid>

      <MPanel title="수집된 타겟 게시글">
        {postRows.length ? (
          <MTable head={['제목', '키워드', '상태', '액션']} rows={postRows} />
        ) : (
          <EmptyPanel message="수집된 게시글이 없습니다. 키워드 스캔을 실행하세요." />
        )}
      </MPanel>
    </div>
  );
}
