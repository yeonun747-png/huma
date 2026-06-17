'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { formatBlogCheckPublishedAt } from '@/lib/format-kst';
import { EmptyPanel } from '@/components/ui/empty-panel';

type BcAccount = Awaited<ReturnType<typeof api.blogCheckAccounts>>['accounts'][number];
type BcPost = Awaited<ReturnType<typeof api.blogCheckPosts>>['posts'][number];
type BcScanProgress = NonNullable<Awaited<ReturnType<typeof api.blogCheckAccounts>>['scanProgress']>;

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function scanPercent(progress: BcScanProgress | null, scanning: boolean): number {
  if (!scanning) return 0;
  if (!progress) return 2;
  if (progress.phase === 'preparing' && progress.percent === 0) return 2;
  return progress.percent;
}

function ScanProgressBar({
  percent,
  compact,
}: {
  percent: number;
  compact?: boolean;
}) {
  return (
    <div className={cn('bc-scan-progress', compact && 'compact')}>
      <div className="bc-scan-progress-track">
        <div className="bc-scan-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="bc-scan-progress-pct">{percent}%</span>
    </div>
  );
}

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

function exposureBadge(status: BcPost['status']): { cls: string; text: string } {
  if (!status) return { cls: 'none', text: '미스캔' };
  if (status === 'strong') return { cls: 'strong', text: '강함' };
  if (status === 'good') return { cls: 'good', text: '양호' };
  if (status === 'weak' || status === 'collect') return { cls: 'weak', text: '약함' };
  return { cls: 'miss', text: '누락' };
}

function openTitleSearch(title: string) {
  const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(title)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
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
  const [scanningAccountId, setScanningAccountId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<BcScanProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [curAcc, setCurAcc] = useState<string | null>(null);
  const [posts, setPosts] = useState<BcPost[]>([]);
  const [filter, setFilter] = useState<'all' | 'strong' | 'good' | 'weak' | 'miss'>('all');
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
      setScanProgress(data.scanProgress);
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
          setScanningAccountId(null);
          setScanProgress(null);
          if (curAcc) void loadPosts(curAcc);
        }
      });
    }, 1000);
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
    if (filter === 'all') return posts;
    if (filter === 'weak') return posts.filter((p) => p.status === 'weak' || p.status === 'collect');
    return posts.filter((p) => p.status === filter);
  }, [posts, filter]);

  const totalMiss = useMemo(() => accounts.reduce((s, a) => s + a.miss_count, 0), [accounts]);
  const globalScanPercent = scanPercent(scanProgress, scanning);

  const cardShowsProgress = useCallback(
    (accountId: string) => {
      if (!scanning) return false;
      if (scanningAccountId === accountId) return true;
      if (!scanningAccountId && scanProgress?.accountId === accountId) return true;
      return false;
    },
    [scanning, scanningAccountId, scanProgress?.accountId],
  );

  const startScan = async (accountId?: string) => {
    if (scanning) return;
    try {
      setScanning(true);
      setScanningAccountId(accountId ?? null);
      setScanProgress({
        accountId: accountId ?? null,
        accountLabel: null,
        completed: 0,
        total: 1,
        percent: 2,
        phase: 'preparing',
      });
      await api.blogCheckScan(accountId);
      await loadAccounts();
    } catch (e) {
      setScanning(false);
      setScanningAccountId(null);
      setScanProgress(null);
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
            {scanning ? (
              <ScanProgressBar percent={globalScanPercent} />
            ) : (
              '⟳ 전체 스캔'
            )}
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
            <div
              key={a.account_id}
              role="button"
              tabIndex={0}
              className={cn('bci-card', curAcc === a.account_id && 'selected')}
              onClick={() => setCurAcc(a.account_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setCurAcc(a.account_id);
              }}
            >
              <div className="bci-card-top">
                <div className="bci-svc" style={{ color: svcColor(a.svc) }}>
                  {a.svc}
                </div>
                <button
                  type="button"
                  className={cn(
                    'bci-scan-btn',
                    scanning && cardShowsProgress(a.account_id) && 'scanning',
                  )}
                  title={`${a.label} 스캔`}
                  disabled={scanning}
                  onClick={(e) => {
                    e.stopPropagation();
                    void startScan(a.account_id);
                  }}
                >
                  {scanning && cardShowsProgress(a.account_id) ? (
                    <ScanProgressBar percent={globalScanPercent} compact />
                  ) : (
                    '⟳ 스캔'
                  )}
                </button>
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
            </div>
          );
        })}
      </div>

      <div className="bc-legend" aria-label="노출 등급 범례">
        <span className="bc-legend-label">등급</span>
        <span className="bc-exposure strong">강함 · 1~3위</span>
        <span className="bc-exposure good">양호 · 4~10위</span>
        <span className="bc-exposure weak">약함 · 10위권 밖</span>
        <span className="bc-exposure miss">누락 · 미수집</span>
      </div>

      <div className="bcp-wrap">
        <div className="bcp-header">
          <div className="bcp-title">
            {selectedAcc
              ? `${selectedAcc.label}  —  최근 ${posts.length}건 (최대 10건) · 누락 ${posts.filter((p) => p.status === 'miss').length}건`
              : '← 계정 카드를 선택하면 최근 발행 10건이 표시됩니다'}
          </div>
          <div className="bcp-filter">
            {(
              [
                ['all', '전체'],
                ['strong', '강함'],
                ['good', '양호'],
                ['weak', '약함'],
                ['miss', '누락'],
              ] as const
            ).map(([f, label]) => (
              <button
                key={f}
                type="button"
                className={cn('bcp-f', filter === f && 'on')}
                onClick={() => setFilter(f)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="bcp-scroll">
        <table className="bcp-tbl">
          <thead>
            <tr>
              <th>노출</th>
              <th>제목</th>
              <th>발행일</th>
              <th>글자</th>
              <th>이미지</th>
              <th>동영상</th>
              <th>인용</th>
              <th>댓글</th>
              <th>공감</th>
              <th>gif</th>
              <th>지도</th>
              <th>히든</th>
              <th>내부링크</th>
              <th>외부링크</th>
            </tr>
          </thead>
          <tbody>
            {!curAcc ? (
              <tr>
                <td colSpan={14} className="py-8 text-center text-[12.5px] text-huma-t3">
                  위 계정 카드를 클릭하세요
                </td>
              </tr>
            ) : filteredPosts.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-6 text-center text-[12.5px] text-huma-t3">
                  {posts.length === 0
                    ? '발행 이력 없음 — ⟳ 스캔으로 노출 등급 갱신'
                    : '해당 조건의 포스트 없음'}
                </td>
              </tr>
            ) : (
              filteredPosts.map((p) => {
                const badge = exposureBadge(p.status);
                return (
                  <tr key={p.post_url}>
                    <td>
                      <span className={cn('bc-exposure', badge.cls)} title={p.rank ? `${p.rank}위` : undefined}>
                        {badge.text}
                        {p.rank ? ` · ${p.rank}위` : ''}
                      </span>
                    </td>
                    <td className="max-w-[220px]">
                      <button
                        type="button"
                        className="bcp-title-link"
                        title={p.title}
                        onClick={() => openTitleSearch(p.title)}
                      >
                        {p.title}
                      </button>
                    </td>
                    <td className="whitespace-nowrap font-mono text-[11px] text-huma-t3">
                      {formatBlogCheckPublishedAt(p.published_at)}
                    </td>
                    <td className="num">{p.chars}</td>
                    <td className="num">{p.img_count}</td>
                    <td className="num">{p.video_count}</td>
                    <td className="num">{p.quote_count}</td>
                    <td className="num">{p.comment_count}</td>
                    <td className="num">{p.like_count}</td>
                    <td className="num">{p.gif_count}</td>
                    <td className="num">{p.map_count}</td>
                    <td className="num">{p.hidden_count}</td>
                    <td className="num">{p.int_link_count}</td>
                    <td className="num">{p.ext_link_count}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
