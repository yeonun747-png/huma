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
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `마지막 스캔: ${hh}:${mm}`;
}

function missReasonUi(post: BcPost): { cls: string; text: string } {
  if (post.status === 'ok') return { cls: 'none', text: '—' };
  if (post.miss_reason && post.miss_reason !== '—') {
    if (post.miss_reason.includes('외부링크')) return { cls: 'ext', text: post.miss_reason };
    return { cls: 'ai', text: post.miss_reason };
  }
  if (post.ext_link_count > 0) return { cls: 'ext', text: '외부링크 포함' };
  if (post.chars < 300) return { cls: 'ai', text: '글자수 부족' };
  return { cls: 'ai', text: 'AI패턴 의심' };
}

function trendLabel(dir: BcAccount['trend_direction']): { text: string; color: string } {
  if (dir === '데이터 부족') return { text: '— 데이터 부족', color: 'var(--t3)' };
  if (dir === '안정') return { text: '✓ 안정', color: 'var(--ok)' };
  if (dir === '악화') return { text: '▲ 악화', color: 'var(--err)' };
  return { text: '▼ 개선', color: 'var(--ok)' };
}

export function BlogCheckView() {
  const [accounts, setAccounts] = useState<BcAccount[]>([]);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [curAcc, setCurAcc] = useState<string | null>(null);
  const [posts, setPosts] = useState<BcPost[]>([]);
  const [filter, setFilter] = useState<'all' | 'miss' | 'ok'>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

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
        if (data && !data.scanning) {
          setScanning(false);
          if (curAcc) void loadPosts(curAcc);
        }
      });
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scanning, loadAccounts, curAcc, loadPosts]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const selectedAcc = useMemo(
    () => accounts.find((a) => a.account_id === curAcc),
    [accounts, curAcc],
  );

  const filteredPosts = useMemo(() => {
    if (filter === 'miss') return posts.filter((p) => p.status === 'miss');
    if (filter === 'ok') return posts.filter((p) => p.status === 'ok');
    return posts;
  }, [posts, filter]);

  const totalMiss = useMemo(() => accounts.reduce((s, a) => s + a.miss_count, 0), [accounts]);

  const startScan = async () => {
    if (scanning) return;
    try {
      setScanning(true);
      await api.blogCheckScan();
      await loadAccounts();
    } catch (e) {
      setScanning(false);
      const msg = (e as Error).message;
      if (msg.includes('스캔이 이미')) {
        showToast('스캔이 이미 진행 중입니다');
      } else {
        showToast(msg);
      }
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
      {toast && (
        <div className="bc-toast" role="status">
          {toast}
        </div>
      )}

      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] text-huma-t3">
          HUMA 자체 지수 · 네이버 공식 지수 아님 · 스파크라인 = 7일 누락 추이
          {totalMiss > 0 && (
            <span className="ml-2 text-huma-err">누락 {totalMiss}건</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="bc-last-scan font-mono text-[11.5px] text-huma-t3">
            {formatLastScan(lastScanAt)}
          </span>
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
          const rate = a.miss_rate;
          const rateColor = rate >= 20 ? 'var(--err)' : rate >= 10 ? 'var(--warn)' : 'var(--ok)';
          const idx = a.idx_score ?? 0;
          const idxPct = Math.round((idx / 10) * 100);
          const sessColor = a.session_status === '오류' ? 'var(--err)' : 'var(--ok)';
          const numericTrend = a.trend.filter((v): v is number => v !== null);
          const maxT = Math.max(...numericTrend, 1);
          const trendUi = trendLabel(a.trend_direction);
          const today = new Date();

          return (
            <button
              key={a.account_id}
              type="button"
              className={cn('bci-card', curAcc === a.account_id && 'selected')}
              onClick={() => setCurAcc(a.account_id)}
            >
              <div className="bci-svc" style={{ color: svcColor(a.svc) }}>
                {a.svc}
              </div>
              <div className="bci-name">{a.label}</div>
              <div className="bci-url">blog.naver.com/{a.blog_url}</div>
              <div className="mb-0.5 font-mono text-[10px] text-huma-t3">HUMA 자체 지수</div>
              <div className="bci-idx-row">
                <div className="bci-idx-bar">
                  <div className="bci-idx-fill" style={{ width: `${idxPct}%` }} />
                </div>
                <span className="bci-idx-val">
                  {a.idx_score != null ? a.idx_score.toFixed(1) : '—'}
                </span>
              </div>
              <div className="my-1.5 h-px bg-[var(--bdr2)]" />
              <div className="bci-miss-row">
                <div>
                  <div
                    className="bci-miss-num"
                    style={{ color: a.miss_count > 0 ? 'var(--err)' : 'var(--ok)' }}
                  >
                    {a.miss_count}
                  </div>
                  <div className="bci-miss-l">누락 / {a.total_posts}건</div>
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
                  <span style={{ color: trendUi.color, fontWeight: 700 }}>{trendUi.text}</span>
                </div>
                <div className="spark-bars">
                  {a.trend.map((v, i) => {
                    const d = new Date(today);
                    d.setDate(d.getDate() - (6 - i));
                    if (v === null) {
                      return (
                        <div
                          key={i}
                          className="spark-bar spark-bar-null"
                          title={`${DAYS[d.getDay()]}: 미스캔`}
                        />
                      );
                    }
                    const h = Math.max(Math.round((v / maxT) * 26), 2);
                    const barColor = v === 0 ? 'var(--ok)' : v >= 4 ? 'var(--err)' : 'var(--warn)';
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
                  세션 {a.session_status}
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
            </tr>
          </thead>
          <tbody>
            {!curAcc ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[12.5px] text-huma-t3">
                  위 계정 카드를 클릭하세요
                </td>
              </tr>
            ) : filteredPosts.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[12.5px] text-huma-t3">
                  {posts.length === 0
                    ? '발행 이력 없음 — posts 테이블 확인 후 ⟳ 전체 스캔'
                    : '해당 조건의 포스트 없음'}
                </td>
              </tr>
            ) : (
              filteredPosts.map((p) => {
                const reason = missReasonUi(p);
                return (
                  <tr key={p.post_url}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-huma-t3">{p.date}</td>
                    <td className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap" title={p.title}>
                      {p.title}
                    </td>
                    <td className="text-center font-mono text-[12px]">{p.chars}</td>
                    <td className="text-center font-mono text-[12px]">{p.img_count}</td>
                    <td className="text-center">
                      {p.ext_link_count > 0 ? (
                        <span className="font-mono text-[12px] font-bold text-huma-err">⚠ {p.ext_link_count}개</span>
                      ) : (
                        <span className="font-mono text-huma-t4">—</span>
                      )}
                    </td>
                    <td>
                      {p.status === 'ok' ? (
                        <span className="bc-badge ok">✓ 수집됨</span>
                      ) : p.status === 'miss' ? (
                        <span className="bc-badge miss">✕ 누락</span>
                      ) : (
                        <span className="font-mono text-[11px] text-huma-t4">미스캔</span>
                      )}
                    </td>
                    <td>
                      <span className={cn('bc-reason', reason.cls)}>{reason.text}</span>
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
