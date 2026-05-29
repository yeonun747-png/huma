'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { MGrid, MPanel, MTable, MTag, MToggle } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

const CAFE_CATEGORIES = [
  '사주·운세',
  '연애·궁합',
  '재물·직업',
  '신년·세운',
  '신점·타로',
  '건강·시험',
  '일반',
] as const;

type GradeRequirements = {
  greeting_post?: number;
  comment_count?: number;
  like_count?: number;
  posts?: number;
  note?: string;
};

type CafeDraft = {
  cafe_name: string;
  category: string;
  keywords: string;
  grade_mode: 'auto' | 'manual';
  greeting_post: string;
  comment_count: string;
  like_count: string;
  posts: string;
  is_active: boolean;
};

const inputCls = 'w-full rounded border border-huma-bdr bg-huma-bg2 px-1.5 py-0.5 text-[10px] text-huma-t';
const selectCls = `${inputCls} max-w-full`;

function categoryOptions(current?: string | null) {
  const cur = current?.trim();
  if (cur && !CAFE_CATEGORIES.includes(cur as (typeof CAFE_CATEGORIES)[number])) {
    return [cur, ...CAFE_CATEGORIES];
  }
  return [...CAFE_CATEGORIES];
}

function keywordsToString(keywords: unknown) {
  return Array.isArray(keywords) ? (keywords as string[]).join(', ') : '';
}

function formatGradeReq(req?: GradeRequirements | null) {
  if (!req) return '—';
  const parts: string[] = [];
  if (req.greeting_post) parts.push(`인사 ${req.greeting_post}`);
  if (req.comment_count) parts.push(`댓글 ${req.comment_count}`);
  if (req.like_count) parts.push(`추천 ${req.like_count}`);
  if (req.posts) parts.push(`글 ${req.posts}`);
  return parts.join(' · ') || '—';
}

function cafeToDraft(c: Record<string, unknown>): CafeDraft {
  const req = (c.grade_requirements ?? {}) as GradeRequirements;
  return {
    cafe_name: String(c.cafe_name ?? c.cafe_url ?? ''),
    category: c.category ? String(c.category) : '',
    keywords: keywordsToString(c.keywords),
    grade_mode: c.grade_auto_detected ? 'auto' : 'manual',
    greeting_post: req.greeting_post != null ? String(req.greeting_post) : '',
    comment_count: req.comment_count != null ? String(req.comment_count) : '',
    like_count: req.like_count != null ? String(req.like_count) : '',
    posts: req.posts != null ? String(req.posts) : '',
    is_active: c.is_active !== false,
  };
}

function draftToPayload(draft: CafeDraft) {
  const grade_requirements: GradeRequirements = {};
  if (draft.greeting_post.trim()) grade_requirements.greeting_post = Number(draft.greeting_post);
  if (draft.comment_count.trim()) grade_requirements.comment_count = Number(draft.comment_count);
  if (draft.like_count.trim()) grade_requirements.like_count = Number(draft.like_count);
  if (draft.posts.trim()) grade_requirements.posts = Number(draft.posts);

  return {
    cafe_name: draft.cafe_name.trim(),
    category: draft.category.trim(),
    keywords: draft.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    grade_auto_detected: draft.grade_mode === 'auto',
    grade_requirements: Object.keys(grade_requirements).length ? grade_requirements : null,
    is_active: draft.is_active,
  };
}

export function CafeViralView() {
  const { workspace } = useWorkspace();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [cafes, setCafes] = useState<Array<Record<string, unknown>>>([]);
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [form, setForm] = useState({ cafe_url: '', cafe_name: '', category: '', keywords: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CafeDraft | null>(null);
  const [saving, setSaving] = useState(false);

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
    try {
      const result = await api.scanCafeViral(String(target.id));
      alert(`키워드 스캔 완료 — ${result.count}건 수집`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '키워드 스캔 실패');
    }
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
      ...(form.category.trim() ? { category: form.category.trim() } : {}),
      keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    });
    setForm({ cafe_url: '', cafe_name: '', category: '', keywords: '' });
    load();
  };

  const startEdit = (c: Record<string, unknown>) => {
    setEditingId(String(c.id));
    setDraft(cafeToDraft(c));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async () => {
    if (!editingId || !draft) return;
    if (!draft.cafe_name.trim()) {
      alert('카페명을 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      await api.updateCafeViral(editingId, draftToPayload(draft));
      cancelEdit();
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const runGradeDetect = async (cafeId: string) => {
    setSaving(true);
    try {
      await api.detectCafeGrade(cafeId);
      load();
      if (editingId === cafeId) {
        const updated = (await api.cafeViralCafes()).find((c) => String(c.id) === cafeId);
        if (updated) setDraft(cafeToDraft(updated));
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '등업 조건 자동 감지 실패');
    } finally {
      setSaving(false);
    }
  };

  const workspaceCafes = cafes.filter((c) => c.workspace === workspace);

  const cafeRows = workspaceCafes.map((c) => {
    const id = String(c.id);
    const isEditing = editingId === id;
    const req = (c.grade_requirements ?? {}) as GradeRequirements;

    if (isEditing && draft) {
      return [
        <div key={`name-${id}`} className="space-y-0.5">
          <input
            className={inputCls}
            value={draft.cafe_name}
            onChange={(e) => setDraft((d) => d && ({ ...d, cafe_name: e.target.value }))}
          />
          <div className="font-mono text-[9px] text-huma-t3">{String(c.cafe_url)}</div>
        </div>,
        <select
          key={`cat-${id}`}
          className={selectCls}
          value={draft.category}
          onChange={(e) => setDraft((d) => d && ({ ...d, category: e.target.value }))}
        >
          <option value="">—</option>
          {categoryOptions(draft.category).map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>,
        <input
          key={`kw-${id}`}
          className={inputCls}
          placeholder="신점,사주,운세"
          value={draft.keywords}
          onChange={(e) => setDraft((d) => d && ({ ...d, keywords: e.target.value }))}
        />,
        <div key={`grade-${id}`} className="space-y-1">
          <select
            className={selectCls}
            value={draft.grade_mode}
            onChange={(e) => setDraft((d) => d && ({ ...d, grade_mode: e.target.value as 'auto' | 'manual' }))}
          >
            <option value="manual">수동</option>
            <option value="auto">자동</option>
          </select>
          {draft.grade_mode === 'manual' ? (
            <div className="grid grid-cols-2 gap-1">
              <input className={inputCls} placeholder="인사" value={draft.greeting_post} onChange={(e) => setDraft((d) => d && ({ ...d, greeting_post: e.target.value }))} />
              <input className={inputCls} placeholder="댓글" value={draft.comment_count} onChange={(e) => setDraft((d) => d && ({ ...d, comment_count: e.target.value }))} />
              <input className={inputCls} placeholder="추천" value={draft.like_count} onChange={(e) => setDraft((d) => d && ({ ...d, like_count: e.target.value }))} />
              <input className={inputCls} placeholder="글" value={draft.posts} onChange={(e) => setDraft((d) => d && ({ ...d, posts: e.target.value }))} />
            </div>
          ) : (
            <button type="button" className="btn-ghost text-[9px]" disabled={saving} onClick={() => runGradeDetect(id)}>
              자동 감지 실행
            </button>
          )}
        </div>,
        <select
          key={`st-${id}`}
          className={selectCls}
          value={draft.is_active ? 'active' : 'inactive'}
          onChange={(e) => setDraft((d) => d && ({ ...d, is_active: e.target.value === 'active' }))}
        >
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>,
        <div key={`act-${id}`} className="flex flex-col gap-1">
          <button type="button" className="btn-primary text-[9px] py-1" disabled={saving} onClick={saveEdit}>저장</button>
          <button type="button" className="btn-ghost text-[9px]" disabled={saving} onClick={cancelEdit}>취소</button>
        </div>,
      ];
    }

    return [
      <div key={`name-${id}`}>
        <div className="text-xs text-huma-t">{String(c.cafe_name ?? c.cafe_url)}</div>
        <div className="font-mono text-[9px] text-huma-t3">{String(c.cafe_url)}</div>
      </div>,
      String(c.category ?? '—'),
      keywordsToString(c.keywords) || '—',
      <div key={`grade-${id}`}>
        <div className="text-[10px]">{c.grade_auto_detected ? '자동' : '수동'}</div>
        <div className="text-[9px] text-huma-t3">{formatGradeReq(req)}</div>
      </div>,
      <MTag key={`st-${id}`} tone={c.is_active === false ? 'idle' : 'ok'}>{c.is_active === false ? '비활성' : '활성'}</MTag>,
      <button key={`act-${id}`} type="button" className="btn-ghost text-[10px]" disabled={editingId !== null && editingId !== id} onClick={() => startEdit(c)}>
        수정
      </button>,
    ];
  });

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

  if (workspace !== 'yeonun') {
    return (
      <div className="animate-fadeIn">
        <MPanel title="카페 바이럴 (v3.21)">
          <EmptyPanel message="카페 침투 바이럴은 연운 전용입니다. 퀴즈·파나나에는 적용되지 않습니다 (규칙 ㉛)." />
        </MPanel>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      <MGrid cols={2}>
        <MPanel title="타겟 카페 등록" className="!mb-0">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[88px] flex-1 space-y-1">
              <span className="block text-[9px] text-huma-t3">카페 URL</span>
              <input
                className="w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-xs"
                placeholder="wgang"
                value={form.cafe_url}
                onChange={(e) => setForm((f) => ({ ...f, cafe_url: e.target.value }))}
              />
            </label>
            <label className="min-w-[88px] flex-1 space-y-1">
              <span className="block text-[9px] text-huma-t3">카페명</span>
              <input
                className="w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-xs"
                placeholder="카페명"
                value={form.cafe_name}
                onChange={(e) => setForm((f) => ({ ...f, cafe_name: e.target.value }))}
              />
            </label>
            <label className="min-w-[100px] flex-1 space-y-1">
              <span className="block text-[9px] text-huma-t3">카테고리</span>
              <select
                className="w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-xs text-huma-t"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="">선택</option>
                {CAFE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[120px] flex-[1.2] space-y-1">
              <span className="block text-[9px] text-huma-t3">키워드</span>
              <input
                className="w-full rounded border border-huma-bdr bg-huma-bg2 px-2 py-1.5 text-xs"
                placeholder="신점,사주,운세"
                value={form.keywords}
                onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
              />
            </label>
            <button type="button" className="btn-primary shrink-0 px-4 py-1.5 text-xs" onClick={addCafe}>
              카페 등록
            </button>
          </div>
        </MPanel>

        <MPanel title="바이럴 설정 (v3.21 · 연운 전용)" className="!mb-0">
          {config.note ? (
            <div className="mb-2 font-mono text-[10px] text-huma-t3">{String(config.note)}</div>
          ) : null}
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
            ※ 비공개 카페(럭키포에버 등) 키워드 스캔 — 계정관리 등록·카페 가입 필수
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-huma-t3">
            ※ 가입(CAPTCHA)은 수동 · HUMA는 등업 워밍업부터 담당
          </div>
        </MPanel>
      </MGrid>

      <MPanel title="등록된 타겟 카페">
        {cafeRows.length ? (
          <MTable head={['카페', '카테고리', '키워드', '등업조건', '상태', '액션']} rows={cafeRows} />
        ) : (
          <EmptyPanel message="등록된 타겟 카페가 없습니다." />
        )}
      </MPanel>

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
