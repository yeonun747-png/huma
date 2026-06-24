'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
import { formatBlogCheckPublishedAt } from '@/lib/format-kst';
import {
  blogCheckQueryMatchesBlogId,
  buildNexearchSearchUrl,
  parseBlogCheckSearchQuery,
} from '@/lib/blog-check-search';
import { EmptyPanel } from '@/components/ui/empty-panel';

type BcAccount = Awaited<ReturnType<typeof api.blogCheckAccounts>>['accounts'][number];
type BcPost = Awaited<ReturnType<typeof api.blogCheckPosts>>['posts'][number];
type BcScanProgress = NonNullable<Awaited<ReturnType<typeof api.blogCheckAccounts>>['scanProgress']>;

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DELTA_SCAN_LABEL = '🆕 새글만 스캔';
const GLOBAL_DELTA_SCAN_LABEL = '🆕 전체 새글 스캔';
const ACCOUNT_FULL_SCAN_LABEL = '⟳ 이 계정만 스캔';
const GLOBAL_FULL_SCAN_LABEL = '⟳ 전체 다시 스캔';
const SEARCH_SCAN_LABEL = '🔍 검색 스캔';
const SCAN_POLL_MS = 1500;

function matchesAccountSearch(a: BcAccount, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (a.label.toLowerCase().includes(q.toLowerCase())) return true;
  if (blogCheckQueryMatchesBlogId(q, a.blog_url)) return true;
  const parsed = parseBlogCheckSearchQuery(q);
  if (parsed && parsed.toLowerCase() === a.blog_url.toLowerCase()) return true;
  return false;
}

function scanPercent(progress: BcScanProgress | null, scanning: boolean): number {
  if (!scanning) return 0;
  if (!progress) return 2;
  if (progress.phase === 'preparing' && progress.percent === 0) return 2;
  return progress.percent;
}

function ScanProgressBar({
  percent,
  compact,
  fullWidth,
  idle,
}: {
  percent: number;
  compact?: boolean;
  fullWidth?: boolean;
  idle?: boolean;
}) {
  return (
    <div className={cn('bc-scan-progress', compact && 'compact', fullWidth && 'full-width', idle && 'idle')}>
      <div className="bc-scan-progress-track">
        <div className="bc-scan-progress-fill" style={{ width: idle ? '0%' : `${percent}%` }} />
      </div>
      <span className="bc-scan-progress-pct">{idle ? '—' : `${percent}%`}</span>
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
  window.open(buildNexearchSearchUrl(title), '_blank', 'noopener,noreferrer');
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
  const [scanningPostNo, setScanningPostNo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [curAcc, setCurAcc] = useState<string | null>(null);
  const [adhocBlogId, setAdhocBlogId] = useState<string | null>(null);
  const [adhocLabel, setAdhocLabel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [posts, setPosts] = useState<BcPost[]>([]);
  const [filter, setFilter] = useState<'all' | 'strong' | 'good' | 'weak' | 'miss'>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningAccountIdRef = useRef<string | null>(null);
  const lastScannedAccountRef = useRef<string | null>(null);
  const postsLoadGenRef = useRef(0);
  const curAccRef = useRef<string | null>(null);
  const adhocBlogIdRef = useRef<string | null>(null);
  const lastProgressKeyRef = useRef('');
  const lastScanningRef = useRef(false);
  const scanInitiatedAtRef = useRef<number | null>(null);
  const serverScanningConfirmedRef = useRef(false);

  useEffect(() => {
    scanningAccountIdRef.current = scanningAccountId;
  }, [scanningAccountId]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const loadAccounts = useCallback(async (opts?: { keepScanning?: boolean }) => {
    try {
      const data = await api.blogCheckAccounts();
      setAccounts(data.accounts);
      setLastScanAt(data.lastScanAt);
      if (!opts?.keepScanning) {
        setScanning(data.scanning);
        setScanProgress(data.scanProgress);
      }
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
    const gen = ++postsLoadGenRef.current;
    try {
      const data = await api.blogCheckPosts(accountId);
      if (gen !== postsLoadGenRef.current) return;
      setPosts(data.posts);
    } catch {
      if (gen !== postsLoadGenRef.current) return;
      setPosts([]);
    }
  }, []);

  const loadAdhocPosts = useCallback(async (blogId: string) => {
    const gen = ++postsLoadGenRef.current;
    try {
      const data = await api.blogCheckPostsByBlog(blogId);
      if (gen !== postsLoadGenRef.current) return;
      setPosts(data.posts);
    } catch {
      if (gen !== postsLoadGenRef.current) return;
      setPosts([]);
    }
  }, []);

  const refreshActivePosts = useCallback(() => {
    const activeAcc = curAccRef.current;
    const activeAdhoc = adhocBlogIdRef.current;
    if (activeAcc) void loadPosts(activeAcc);
    if (activeAdhoc) void loadAdhocPosts(activeAdhoc);
  }, [loadPosts, loadAdhocPosts]);

  const selectAccount = useCallback((accountId: string) => {
    setCurAcc(accountId);
    setAdhocBlogId(null);
    setAdhocLabel(null);
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (adhocBlogId) {
      void loadAdhocPosts(adhocBlogId);
      return;
    }
    if (curAcc) void loadPosts(curAcc);
    else setPosts([]);
  }, [curAcc, adhocBlogId, loadPosts, loadAdhocPosts]);

  useEffect(() => {
    curAccRef.current = curAcc;
  }, [curAcc]);
  useEffect(() => {
    adhocBlogIdRef.current = adhocBlogId;
  }, [adhocBlogId]);

  useEffect(() => {
    if (!scanning) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    const tick = async () => {
      try {
        const status = await api.blogCheckStatus();
        const nextProgress = status.scanProgress;
        const progressKey = nextProgress
          ? [
              nextProgress.accountId,
              nextProgress.completed,
              nextProgress.total,
              nextProgress.percent,
              nextProgress.phase,
            ].join('|')
          : '';

        if (status.scanning) {
          serverScanningConfirmedRef.current = true;
        }

        if (status.scanning !== lastScanningRef.current) {
          if (!status.scanning) {
            const initiatedAt = scanInitiatedAtRef.current;
            const withinGrace =
              initiatedAt != null &&
              Date.now() - initiatedAt < 8000 &&
              !serverScanningConfirmedRef.current;
            if (!withinGrace) {
              lastScanningRef.current = status.scanning;
              setScanning(status.scanning);
            }
          } else {
            lastScanningRef.current = status.scanning;
            setScanning(status.scanning);
          }
        }
        if (progressKey !== lastProgressKeyRef.current) {
          lastProgressKeyRef.current = progressKey;
          setScanProgress(nextProgress);
        }

        if (status.scanning) {
          if (status.scanProgress?.accountId) {
            lastScannedAccountRef.current = status.scanProgress.accountId;
          }
          return;
        }

        {
          const initiatedAt = scanInitiatedAtRef.current;
          const withinGrace =
            initiatedAt != null && Date.now() - initiatedAt < 8000 && !serverScanningConfirmedRef.current;
          if (withinGrace) return;
        }

        lastProgressKeyRef.current = '';
        lastScanningRef.current = false;
        setScanning(false);
        setScanProgress(null);
        setScanningPostNo(null);
        setScanningAccountId(null);
        scanningAccountIdRef.current = null;
        scanInitiatedAtRef.current = null;
        serverScanningConfirmedRef.current = false;
        refreshActivePosts();
        void loadAccounts();
      } catch {
        /* poll 실패 — 다음 tick 재시도 */
      }
    };

    void tick();
    pollRef.current = setInterval(() => {
      void tick();
    }, SCAN_POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [scanning, loadAccounts, refreshActivePosts]);

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

  const visibleAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    return accounts.filter((a) => matchesAccountSearch(a, searchQuery));
  }, [accounts, searchQuery]);

  const filteredPosts = useMemo(() => {
    if (filter === 'all') return posts;
    if (filter === 'weak') return posts.filter((p) => p.status === 'weak' || p.status === 'collect');
    return posts.filter((p) => p.status === filter);
  }, [posts, filter]);

  const totalMiss = useMemo(() => accounts.reduce((s, a) => s + a.miss_count, 0), [accounts]);
  const globalScanPercent = scanPercent(scanProgress, scanning);

  const scanStatusLabel = useMemo(() => {
    if (!scanning) return null;
    if (scanProgress?.accountLabel?.trim()) return scanProgress.accountLabel.trim();
    if (scanProgress?.accountId) {
      return accounts.find((a) => a.account_id === scanProgress.accountId)?.label ?? null;
    }
    if (adhocBlogId) return adhocLabel ?? adhocBlogId;
    return '전체 스캔';
  }, [scanning, scanProgress, accounts, adhocBlogId, adhocLabel]);

  const cardShowsProgress = useCallback(
    (accountId: string) => {
      if (!scanning) return false;
      if (scanningAccountId === accountId) return true;
      if (!scanningAccountId && scanProgress?.accountId === accountId) return true;
      return false;
    },
    [scanning, scanningAccountId, scanProgress?.accountId],
  );

  const startScan = async (
    accountId?: string,
    opts?: { mode?: 'full' | 'delta' | 'posts'; postNos?: string[] },
    focusPostNo?: string | null,
  ) => {
    if (scanning) return;
    try {
      setScanning(true);
      setScanningAccountId(accountId ?? null);
      scanningAccountIdRef.current = accountId ?? null;
      lastScannedAccountRef.current = accountId ?? null;
      setScanningPostNo(focusPostNo ?? null);
      scanInitiatedAtRef.current = Date.now();
      serverScanningConfirmedRef.current = false;
      if (accountId) {
        setCurAcc(accountId);
        setAdhocBlogId(null);
        setAdhocLabel(null);
      }
      setScanProgress({
        accountId: accountId ?? null,
        accountLabel: null,
        completed: 0,
        total: 1,
        percent: 2,
        phase: 'preparing',
      });
      await api.blogCheckScan(accountId, opts ?? { mode: accountId ? 'full' : 'full' });
    } catch (e) {
      setScanning(false);
      setScanningAccountId(null);
      scanningAccountIdRef.current = null;
      setScanningPostNo(null);
      setScanProgress(null);
      scanInitiatedAtRef.current = null;
      serverScanningConfirmedRef.current = false;
      const msg = (e as Error).message;
      if (msg.includes('스캔이 이미')) {
        showToast('스캔이 이미 진행 중입니다');
      } else {
        showToast(msg);
      }
    }
  };

  const searchAndScan = async () => {
    const q = searchQuery.trim();
    if (!q || scanning) return;
    try {
      setScanning(true);
      setScanningPostNo(null);
      scanInitiatedAtRef.current = Date.now();
      serverScanningConfirmedRef.current = false;
      setScanProgress({
        accountId: null,
        accountLabel: q,
        completed: 0,
        total: 1,
        percent: 2,
        phase: 'preparing',
      });
      const result = await api.blogCheckSearchScan(q);
      if (result.registered && result.accountId) {
        setAdhocBlogId(null);
        setAdhocLabel(null);
        adhocBlogIdRef.current = null;
        setCurAcc(result.accountId);
        curAccRef.current = result.accountId;
        setScanningAccountId(result.accountId);
        scanningAccountIdRef.current = result.accountId;
        lastScannedAccountRef.current = result.accountId;
        showToast(`${result.label ?? result.blogId} — 등록 계정 스캔 시작`);
      } else {
        setCurAcc(null);
        setAdhocBlogId(result.blogId);
        setAdhocLabel(result.label ?? result.blogId);
        adhocBlogIdRef.current = result.blogId;
        setScanningAccountId(null);
        scanningAccountIdRef.current = null;
        lastScannedAccountRef.current = null;
        showToast(`${result.blogId} — 외부 블로그 스캔 시작`);
      }
    } catch (e) {
      setScanning(false);
      setScanningAccountId(null);
      scanningAccountIdRef.current = null;
      setScanProgress(null);
      scanInitiatedAtRef.current = null;
      serverScanningConfirmedRef.current = false;
      const msg = (e as Error).message;
      if (msg.includes('스캔이 이미')) {
        showToast('스캔이 이미 진행 중입니다');
      } else if (msg.includes('인식')) {
        showToast('블로그 ID·URL·계정명을 확인하세요');
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

  const scanningActive = scanning || scanProgress != null;

  return (
    <div className={cn('blog-check-view animate-fadeIn', scanningActive && 'scanning-active')}>
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
            className="bc-scan-btn bc-scan-btn-delta-header"
            onClick={() => void startScan(undefined, { mode: 'delta' })}
            disabled={scanning}
            title="모든 계정 · 24h 이내 미스캔 글만"
          >
            {GLOBAL_DELTA_SCAN_LABEL}
          </button>
          <button
            type="button"
            className="bc-scan-btn"
            onClick={() => void startScan(undefined, { mode: 'full' })}
            disabled={scanning}
          >
            {GLOBAL_FULL_SCAN_LABEL}
          </button>
        </div>
      </div>

      <div
        className={cn('bc-scan-status', scanning && 'bc-scan-status-active')}
        role="status"
        aria-live="polite"
        aria-busy={scanning}
      >
        <span className="bc-scan-status-label">
          {scanning ? (scanStatusLabel ?? '스캔 중…') : '스캔 대기'}
        </span>
        <ScanProgressBar percent={globalScanPercent} fullWidth idle={!scanning} />
      </div>

      <div className="bc-search-row">
        <input
          type="search"
          className="bc-search-input"
          placeholder="goricc · blog.naver.com/goricc · 계정명"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void searchAndScan();
          }}
          disabled={scanning}
        />
        <button
          type="button"
          className="bc-search-scan-btn"
          onClick={() => void searchAndScan()}
          disabled={scanning || !searchQuery.trim()}
          title="입력한 블로그 최근 10건 스캔"
        >
          {SEARCH_SCAN_LABEL}
        </button>
      </div>

      <div className="bci-grid">
        {visibleAccounts.map((a) => {
          const rate = a.miss_rate;
          const rateColor = rate >= 20 ? 'var(--err)' : rate >= 10 ? 'var(--warn)' : 'var(--ok)';
          const idx = a.idx_score;
          const idxPct = idx != null ? Math.round((idx / 10) * 100) : 0;
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
              className={cn(
                'bci-card',
                curAcc === a.account_id && 'selected',
                scanning && cardShowsProgress(a.account_id) && 'bci-card-scanning',
              )}
              onClick={() => selectAccount(a.account_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') selectAccount(a.account_id);
              }}
            >
              <div className="bci-card-top">
                <div className="bci-svc" style={{ color: svcColor(a.svc) }}>
                  {a.svc}
                </div>
                <div className="bci-scan-actions">
                  <button
                    type="button"
                    className="bci-scan-btn"
                    title={`${a.label} — 최근 10건 전체 스캔`}
                    disabled={scanning}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectAccount(a.account_id);
                      void startScan(a.account_id, { mode: 'full' });
                    }}
                  >
                    {ACCOUNT_FULL_SCAN_LABEL}
                  </button>
                  <button
                    type="button"
                    className="bci-scan-btn bci-scan-btn-delta"
                    title={`${a.label} · 24h 이내 미스캔 글만`}
                    disabled={scanning}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectAccount(a.account_id);
                      void startScan(a.account_id, { mode: 'delta' });
                    }}
                  >
                    {DELTA_SCAN_LABEL}
                  </button>
                </div>
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
                          title={`${DAYS[d.getDay()]}: 해당일 발행·스캔 없음`}
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

      {searchQuery.trim() && visibleAccounts.length === 0 && (
        <div className="bc-search-empty font-mono text-[11px] text-huma-t3">
          등록 계정 없음 — 「{SEARCH_SCAN_LABEL}」으로 외부 블로그를 스캔할 수 있습니다
        </div>
      )}

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
            {adhocBlogId
              ? `${adhocLabel ?? adhocBlogId}  —  최근 ${posts.length}건 (외부 · 미등록) · 누락 ${posts.filter((p) => p.status === 'miss').length}건`
              : selectedAcc
                ? `${selectedAcc.label}  —  최근 ${posts.length}건 (최대 10건) · 누락 ${posts.filter((p) => p.status === 'miss').length}건`
                : '← 계정 카드를 선택하거나 검색 스캔하세요'}
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
            {!curAcc && !adhocBlogId ? (
              <tr>
                <td colSpan={14} className="py-8 text-center text-[12.5px] text-huma-t3">
                  위 계정 카드를 클릭하거나 검색란에서 블로그를 스캔하세요
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
                const rowScanning = scanning && scanningPostNo === p.post_no;
                return (
                  <tr key={p.post_url}>
                    <td>
                      {!p.status ? (
                        curAcc && !adhocBlogId ? (
                          <button
                            type="button"
                            className={cn('bc-exposure scan-btn none', rowScanning && 'scanning')}
                            title="이 포스트만 스캔"
                            disabled={scanning && !rowScanning}
                            onClick={() => {
                              if (!curAcc || !p.post_no) return;
                              void startScan(curAcc, { mode: 'posts', postNos: [p.post_no] }, p.post_no);
                            }}
                          >
                            {rowScanning ? '스캔…' : '미스캔'}
                          </button>
                        ) : (
                          <span className="bc-exposure none">미스캔</span>
                        )
                      ) : (
                        <span className={cn('bc-exposure', badge.cls)} title={p.rank ? `${p.rank}위` : undefined}>
                          {badge.text}
                          {p.rank ? ` · ${p.rank}위` : ''}
                        </span>
                      )}
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
