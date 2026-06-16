'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { EmptyPanel } from '@/components/ui/empty-panel';

type BcAccount = Awaited<ReturnType<typeof api.blogCheckAccounts>>['accounts'][number];
type BcPost = Awaited<ReturnType<typeof api.blogCheckPosts>>['posts'][number];

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function svcColor(svc: string): string {
  if (svc === '연운') return 'var(--acc)';
  if (svc === '퀴즈') return 'var(--blue)';
  return 'var(--t2)';
}

function formatLastScan(iso: string | null): string {
  if (!iso) return '마지막 스캔: —';
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (diffMin < 2) return '마지막 스캔: 방금';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `마지막 스캔: ${d.toDateString() === now.toDateString() ? `오늘 ${hh}:${mm}` : `${hh}:${mm}`}`;
}

function missReasonUi(post: BcPost, acc?: BcAccount): { cls: string; text: string } {
  if (post.status === 'ok') return { cls: 'none', text: '—' };
  if (post.missReason) {
    if (post.missReason.includes('외부링크')) return { cls: 'ext', text: post.missReason };
    if (post.missReason.includes('발행간격')) return { cls: 'ai', text: post.missReason };
    return { cls: 'ai', text: post.missReason };
  }
  if (post.ext > 0) return { cls: 'ext', text: '외부링크 포함' };
  if (acc?.pattern === '높음') return { cls: 'ai', text: 'AI패턴 감지' };
  if (acc?.pattern === '중간') return { cls: 'ai', text: 'AI패턴 의심' };
  return { cls: 'ai', text: 'AI패턴 의심' };
}

export function BlogCheckView() {
  const [accounts, setAccounts] = useState<BcAccount[]>([]);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [curAcc, setCurAcc] = useState<string | null>(null);
  const [posts, setPosts] = useState<BcPost[]>([]);
  const [filter, setFilter] = useState<'all' | 'miss' | 'ok'>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await api.blogCheckAccounts();
      setAccounts(data.accounts);
      setLastScanAt(data.lastScanAt);
      setScanning(data.scanning);
      setError(null);
      return data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPosts = useCallback(async (accountId: string) => {
    try {
      const data = await api.blogCheckPosts(accountId);
      setPosts(data.posts);
    } catch {
      setPosts([]);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (curAcc) void loadPosts(curAcc);
  }, [curAcc, loadPosts]);

  useEffect(() => {
    if (!scanning) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(() => {
      void loadAccounts().then((data) => {
        if (data && !data.scanning && curAcc) void loadPosts(curAcc);
      });
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scanning, loadAccounts, curAcc, loadPosts]);

  const selectedAcc = useMemo(() => accounts.find((a) => a.id === curAcc), [accounts, curAcc]);

  const filteredPosts = useMemo(() => {
    if (filter === 'miss') return posts.filter((p) => p.status === 'miss');
    if (filter === 'ok') return posts.filter((p) => p.status === 'ok');
    return posts;
  }, [posts, filter]);

  const totalMiss = useMemo(() => accounts.reduce((s, a) => s + a.miss, 0), [accounts]);

  const startScan = async () => {
    if (scanning) return;
    try {
      setScanning(true);
      await api.blogCheckScan();
      await loadAccounts();
    } catch (e) {
      setScanning(false);
      alert((e as Error).message);
    }
  };

  if (loading && !accounts.length) {
    return <EmptyPanel message="블로그 지수 데이터 로딩 중…" />;
  }

  if (error && !accounts.length) {
    return <EmptyPanel message={`블로그 지수 API 오류: ${error}`} />;
  }

  return (
    <div className="blog-check-view animate-fadeIn">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] text-huma-t3">
          계정 카드 클릭 → 발행글 상세 · 스파크라인 = 7일 누락 추이
          {totalMiss > 0 && (
            <span className="ml-2 text-huma-err">누락 {totalMiss}건</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-[11.5px] text-huma-t3">{formatLastScan(lastScanAt)}</span>
          <button
            type="button"
            className={cn('bc-scan-btn', scanning && 'scanning')}
            onClick={() => void startScan()}
            disabled={scanning}
          >
            {scanning ? '⏳ 스캔 중…' : '⟳ 전체 스캔'}
          </button>
        </div>
      </div>

      <div className="bci-grid">
        {accounts.map((a) => {
          const rate = a.posts > 0 ? Math.round((a.miss / a.posts) * 100) : 0;
          const rateColor = rate >= 20 ? 'var(--err)' : rate >= 10 ? 'var(--warn)' : 'var(--ok)';
          const idxPct = Math.round((a.idx / 10) * 100);
          const sessColor = a.session === '오류' ? 'var(--err)' : 'var(--ok)';
          const maxT = Math.max(...a.trend, 1);
          const today = new Date();
          const isFlat = a.trend.every((v) => v === 0);
          const trendDir = a.trend[6] > a.trend[0] ? '▲ 악화' : '▼ 개선';
          const trendColor = a.trend[6] > a.trend[0] ? 'var(--err)' : 'var(--ok)';

          return (
            <button
              key={a.id}
              type="button"
              className={cn('bci-card', curAcc === a.id && 'selected')}
              onClick={() => setCurAcc(a.id)}
            >
              <div className="bci-svc" style={{ color: svcColor(a.svc) }}>
                {a.svc}
              </div>
              <div className="bci-name">{a.label}</div>
              <div className="bci-url">blog.naver.com/{a.url}</div>
              <div className="mb-0.5 font-mono text-[10px] text-huma-t3">블로그 지수</div>
              <div className="bci-idx-row">
                <div className="bci-idx-bar">
                  <div className="bci-idx-fill" style={{ width: `${idxPct}%` }} />
                </div>
                <span className="bci-idx-val">{a.idx.toFixed(1)}</span>
              </div>
              <div className="my-1.5 h-px bg-[var(--bdr2)]" />
              <div className="bci-miss-row">
                <div>
                  <div className="bci-miss-num" style={{ color: a.miss > 0 ? 'var(--err)' : 'var(--ok)' }}>
                    {a.miss}
                  </div>
                  <div className="bci-miss-l">누락 / {a.posts}건</div>
                </div>
                <div className="text-right">
                  <div className="bci-rate" style={{ color: rateColor }}>
                    {rate}%
                  </div>
                  <div className="mt-0.5 text-[10px] text-huma-t3">누락률</div>
                </div>
              </div>
              <div className="spark-wrap">
                <div className="spark-label">
                  <span>7일 누락 추이</span>
                  <span style={{ color: isFlat ? 'var(--ok)' : trendColor, fontWeight: 700 }}>
                    {isFlat ? '✓ 안정' : trendDir}
                  </span>
                </div>
                <div className="spark-bars">
                  {a.trend.map((v, i) => {
                    const h = Math.max(Math.round((v / maxT) * 26), 2);
                    const barColor = v === 0 ? 'var(--ok)' : v >= 4 ? 'var(--err)' : 'var(--warn)';
                    const d = new Date(today);
                    d.setDate(d.getDate() - (6 - i));
                    return (
                      <div
                        key={i}
                        className="spark-bar"
                        title={`${DAYS[d.getDay()]}: 누락 ${v}건`}
                        style={{ height: `${h}px`, background: barColor }}
                      />
                    );
                  })}
                </div>
                <div className="spark-days">
                  {a.trend.map((_, i) => {
                    const d = new Date(today);
                    d.setDate(d.getDate() - (6 - i));
                    return (
                      <span key={i} className="spark-day">
                        {DAYS[d.getDay()]}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <span className="bci-status-dot" style={{ background: sessColor }} />
                <span className="font-mono text-[10.5px]" style={{ color: sessColor }}>
                  세션 {a.session}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="bcp-wrap">
        <div className="bcp-header">
          <div className="bcp-title">
            {selectedAcc
              ? `${selectedAcc.label}  —  발행글 ${posts.length}건 중 누락 ${posts.filter((p) => p.status === 'miss').length}건`
              : '← 계정 카드를 선택하면 발행글이 표시됩니다'}
          </div>
          <div className="bcp-filter">
            {(['all', 'miss', 'ok'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={cn('bcp-f', filter === f && 'on')}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '전체' : f === 'miss' ? '누락만' : '수집됨'}
              </button>
            ))}
          </div>
        </div>
        <table className="bcp-tbl">
          <thead>
            <tr>
              <th>발행일</th>
              <th>제목</th>
              <th>글자수</th>
              <th>이미지</th>
              <th>외부링크</th>
              <th>수집 여부</th>
              <th>누락 원인</th>
              <th>조치</th>
            </tr>
          </thead>
          <tbody>
            {!curAcc ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-[12.5px] text-huma-t3">
                  위 계정 카드를 클릭하세요
                </td>
              </tr>
            ) : filteredPosts.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-[12.5px] text-huma-t3">
                  {posts.length === 0 ? '스캔 후 포스트 목록이 표시됩니다 — ⟳ 전체 스캔 실행' : '해당 조건의 포스트 없음'}
                </td>
              </tr>
            ) : (
              filteredPosts.map((p) => {
                const reason = missReasonUi(p, selectedAcc);
                return (
                  <tr key={p.postUrl}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-huma-t3">{p.date}</td>
                    <td className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap" title={p.title}>
                      {p.title}
                    </td>
                    <td className="text-center font-mono text-[12px]">{p.chars}</td>
                    <td className="text-center font-mono text-[12px]">{p.img}</td>
                    <td className="text-center">
                      {p.ext > 0 ? (
                        <span className="font-mono text-[12px] font-bold text-huma-err">⚠ {p.ext}개</span>
                      ) : (
                        <span className="font-mono text-huma-t4">—</span>
                      )}
                    </td>
                    <td>
                      {p.status === 'ok' ? (
                        <span className="bc-badge ok">✓ 수집됨</span>
                      ) : (
                        <span className="bc-badge miss">✕ 누락</span>
                      )}
                    </td>
                    <td>
                      <span className={cn('bc-reason', reason.cls)}>{reason.text}</span>
                    </td>
                    <td>
                      {p.status === 'miss' && p.ext > 0 ? (
                        <button
                          type="button"
                          className="rounded border border-huma-err bg-[var(--err-bg)] px-2 py-0.5 text-[10.5px] text-huma-err"
                          onClick={() =>
                            alert(`[링크 제거 예약]\n포스트: ${p.title}\n\n향후 자동 처리 연동 예정`)
                          }
                        >
                          링크 제거
                        </button>
                      ) : (
                        <span className="text-[11px] text-huma-t4">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
