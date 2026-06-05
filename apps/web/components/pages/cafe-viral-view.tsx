'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { MGrid, MPanel, MStat } from '@/components/mockup/primitives';
import {
  CAFE_FEED_MOCK,
  CAFE_KPI_MOCK,
  CAFE_SIDEBAR_MOCK,
  type CafeFeedRow,
  type CafeFeedType,
} from '@/lib/cafe-mock-data';

function feedTypeClass(type: CafeFeedType) {
  if (type === 'HUMA 글') return 'm-caf-write';
  if (type === '자문자답') return 'm-caf-qa';
  if (type === '댓글') return 'm-caf-comment';
  if (type === '공감') return 'm-caf-like';
  return 'm-caf-organic';
}

function postToFeedRow(p: Record<string, unknown>): CafeFeedRow | null {
  const title = String(p.post_title ?? p.title ?? '').trim();
  if (!title) return null;
  const cafeRef = p.huma_cafe_viral_cafes as { cafe_name?: string; cafe_url?: string } | null;
  const isSelf = Boolean(p.is_self_post);
  const hasReply = Boolean(p.reply_posted);
  const type: CafeFeedType = isSelf ? '자문자답' : hasReply ? '댓글' : '진성유저';
  const ts = String(p.posted_at ?? p.created_at ?? '');
  return {
    id: `api-${p.id}`,
    cafeId: String(p.cafe_id ?? 'all'),
    type,
    time: ts ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(ts)) : '—',
    title,
    sub: `${cafeRef?.cafe_name ?? '카페'} · ${String(p.post_url ?? '').replace(/^https?:\/\//, '').slice(0, 36)}`,
    reaction: hasReply ? '답글 완료' : p.status === 'pending' ? '미답글' : String(p.status ?? '—'),
    expand: p.reply_posted ? String(p.reply_posted) : p.reply_drafted ? String(p.reply_drafted) : undefined,
  };
}

export function CafeViralView() {
  const [cafes, setCafes] = useState<Array<Record<string, unknown>>>([]);
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [kpi, setKpi] = useState<Awaited<ReturnType<typeof api.cafeViralKpi>>>(CAFE_KPI_MOCK);
  const [selectedCafe, setSelectedCafe] = useState('jeomsamo');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ cafe_url: '', cafe_name: '', category: '', keywords: '' });
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.cafeViralCafes(), api.cafeViralPosts(), api.cafeViralKpi()])
      .then(([c, p, k]) => {
        setCafes(c);
        setPosts(p);
        setKpi(k);
      })
      .catch(() => {
        setCafes([]);
        setPosts([]);
        setKpi(CAFE_KPI_MOCK);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (cafes.length && selectedCafe === 'jeomsamo') {
      setSelectedCafe(String(cafes[0].id));
    }
  }, [cafes, selectedCafe]);

  const sidebarItems = useMemo(() => {
    if (cafes.length) {
      return cafes.map((c) => ({
        id: String(c.id),
        name: String(c.cafe_name ?? c.cafe_url ?? '카페'),
        icon: '🏛',
        meta: String(c.category ?? '등록 카페'),
        url: c.cafe_url ? `https://cafe.naver.com/${String(c.cafe_url).split('/')[0]}` : undefined,
      }));
    }
    return CAFE_SIDEBAR_MOCK;
  }, [cafes]);

  const feedRows = useMemo(() => {
    const apiRows = posts.map(postToFeedRow).filter((r): r is CafeFeedRow => r !== null);
    const merged = posts.length > 0 ? apiRows : CAFE_FEED_MOCK;
    return merged.filter((row) => {
      if (selectedCafe !== 'all' && row.cafeId !== selectedCafe) return false;
      if (typeFilter !== 'all' && row.type !== typeFilter) return false;
      return true;
    });
  }, [posts, selectedCafe, typeFilter]);

  const selectedMeta = sidebarItems.find((c) => c.id === selectedCafe) ?? sidebarItems[0];

  const addCafe = async () => {
    if (!form.cafe_url.trim()) return;
    await api.createCafeViral({
      workspace: 'yeonun',
      cafe_url: form.cafe_url.trim(),
      cafe_name: form.cafe_name.trim() || form.cafe_url.trim(),
      ...(form.category.trim() ? { category: form.category.trim() } : {}),
      keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
    });
    setForm({ cafe_url: '', cafe_name: '', category: '', keywords: '' });
    setShowRegister(false);
    load();
  };

  const runScan = async () => {
    const target = cafes.find((c) => c.is_active !== false) ?? cafes[0];
    if (!target?.id) {
      alert('활성 타겟 카페를 먼저 등록하세요.');
      return;
    }
    setScanning(true);
    try {
      const result = await api.scanCafeViral(String(target.id));
      alert(`키워드 스캔 완료 — ${result.count}건 수집`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '키워드 스캔 실패');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MStat label="크롤링 게시글" value={kpi.crawled.value} sub={kpi.crawled.sub} />
        <MStat label="오늘 활동" value={kpi.today.value} sub={kpi.today.sub} tone={kpi.today.tone} />
        <MStat label="자문자답" value={kpi.selfQa.value} sub={kpi.selfQa.sub} />
        <MStat label="진성 유저 반응" value={kpi.organic.value} sub={kpi.organic.sub} tone={kpi.organic.tone} />
      </MGrid>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_1fr]">
        <MPanel title="등록 카페" className="mb-0">
          {sidebarItems.map((cafe) => (
            <button
              key={cafe.id}
              type="button"
              onClick={() => setSelectedCafe(cafe.id)}
              className={cn('m-cr w-full text-left', selectedCafe === cafe.id && 'on')}
            >
              <span className="m-cr-i">{cafe.icon}</span>
              <div>
                <div className="m-cr-t">{cafe.name}</div>
                <div className="m-cr-m">{cafe.meta}</div>
              </div>
            </button>
          ))}
          <button type="button" className="btn-ghost btn-sm mt-2 w-full" onClick={() => setShowRegister((v) => !v)}>
            + 타겟 등록
          </button>
        </MPanel>

        <MPanel
          title={
            <>
              {selectedMeta?.name ?? '카페'} 활동 피드
              <span className="ml-auto flex items-center gap-2">
                {selectedMeta?.url && (
                  <a
                    href={selectedMeta.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-huma-acc bg-transparent px-2 py-0.5 font-mono text-[10.5px] text-huma-acc hover:bg-[var(--glow)]"
                  >
                    카페에서 보기 ↗
                  </a>
                )}
                <select
                  className="rounded border border-huma-bdr bg-huma-bg3 px-1.5 py-0.5 font-mono text-[11px] text-huma-t2"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="all">전체 유형</option>
                  <option value="HUMA 글">HUMA 글</option>
                  <option value="자문자답">자문자답</option>
                  <option value="댓글">댓글</option>
                  <option value="공감">공감</option>
                </select>
              </span>
            </>
          }
          className="mb-0"
        >
          <div className="m-cafe-feed-head">
            <span>유형</span>
            <span>시각</span>
            <span>게시글 / 활동 내용</span>
            <span>반응</span>
          </div>
          {feedRows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={cn('m-cafe-act-row w-full text-left', row.organic && 'organic')}
              onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
            >
              <span className={cn('m-cafe-act-type', feedTypeClass(row.type))}>{row.type}</span>
              <span className="font-mono text-[10.5px] text-huma-t3">{row.time}</span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-huma-t">{row.title}</div>
                <div className="mt-0.5 font-mono text-[11px] text-huma-t3">{row.sub}</div>
                {row.expand && expandedId === row.id && <div className="m-cafe-act-expand open">{row.expand}</div>}
              </div>
              <span className="font-mono text-[10.5px] text-huma-t3">{row.reaction}</span>
            </button>
          ))}
        </MPanel>
      </div>

      {showRegister && (
        <MPanel title="타겟 카페 등록 (API)" className="mt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="m-model-select"
              placeholder="카페 URL"
              value={form.cafe_url}
              onChange={(e) => setForm((f) => ({ ...f, cafe_url: e.target.value }))}
            />
            <input
              className="m-model-select"
              placeholder="카페명"
              value={form.cafe_name}
              onChange={(e) => setForm((f) => ({ ...f, cafe_name: e.target.value }))}
            />
            <input
              className="m-model-select"
              placeholder="카테고리"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
            <input
              className="m-model-select"
              placeholder="키워드 (쉼표 구분)"
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={addCafe}>
              등록
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowRegister(false)}>
              취소
            </button>
          </div>
        </MPanel>
      )}

      <div className="mt-3 flex justify-end">
        <button type="button" className="btn-ghost btn-sm" onClick={runScan} disabled={scanning}>
          {scanning ? '스캔 중…' : '↻ 키워드 스캔'}
        </button>
      </div>
    </div>
  );
}
