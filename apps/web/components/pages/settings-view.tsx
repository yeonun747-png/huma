'use client';



import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { api } from '@/lib/api';
import { refreshNavBadges } from '@/lib/nav-badge-events';

import { cn } from '@/lib/constants';
import { formatLogKst } from '@/lib/format-kst';
import {
  classifyWatcherLogType,
  formatWatcherLogMessage,
  isLayer4FailSafeLog,
  isWatcherRealtimeErrorLog,
  layer4ActionLabel,
  resolveWatcherLogService,
  watcherLogTypeTagClass,
  type WatcherLogRow,
} from '@/lib/watcher-log-label';

import { MGrid, MPanel } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { PostingWarmupStatusPanel, type PostingWarmupStatusRow } from '@/components/settings/posting-warmup-status-panel';



function SettingsToggle({

  label,

  sub,

  badge,

  badgeTone = 'acc',

  value,

  onChange,

}: {

  label: ReactNode;

  sub?: string;

  badge?: string;

  badgeTone?: 'acc' | 'google';

  value: boolean;

  onChange: (v: boolean) => void;

}) {

  return (

    <div className="m-tw">

      <div>

        <div className="m-tw-label flex flex-wrap items-center gap-1">

          {label}

          {badge && (

            <span

              className={cn(

                'rounded px-1 py-px font-mono text-[9.5px]',

                badgeTone === 'google'

                  ? 'bg-[rgba(66,133,244,0.15)] text-[#4285f4]'

                  : 'bg-[var(--glow)] text-huma-acc',

              )}

            >

              {badge}

            </span>

          )}

        </div>

        {sub && <div className="m-tw-sub">{sub}</div>}

      </div>

      <button type="button" className={cn('m-tgl', value && 'on')} onClick={() => onChange(!value)} aria-pressed={value} />

    </div>

  );

}



type PostingWarmupSettings = {
  skip_pct: number;
  light_pct: number;
  full_pct: number;
};

const DEFAULT_POSTING_WARMUP: PostingWarmupSettings = {
  skip_pct: 80,
  light_pct: 15,
  full_pct: 5,
};

function normalizePostingWarmup(raw: unknown): PostingWarmupSettings {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Partial<PostingWarmupSettings>;
  const clamp = (v: unknown, fallback: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(100, Math.max(0, Math.round(n)));
  };
  return {
    skip_pct: clamp(row.skip_pct, DEFAULT_POSTING_WARMUP.skip_pct),
    light_pct: clamp(row.light_pct, DEFAULT_POSTING_WARMUP.light_pct),
    full_pct: clamp(row.full_pct, DEFAULT_POSTING_WARMUP.full_pct),
  };
}

function SettingsPercentRow({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = (raw: string) => {
    if (raw === '' || raw === '-') {
      onChange(0);
      setDraft('0');
      return;
    }
    const n = Math.min(100, Math.max(0, Number(raw) || 0));
    onChange(n);
    setDraft(String(n));
  };

  return (
    <div className="m-tw">
      <div>
        <div className="m-tw-label">{label}</div>
        {sub && <div className="m-tw-sub">{sub}</div>}
      </div>
      <label className="m-pct-field">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          aria-label={`${label} 확률`}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              setDraft('');
              return;
            }
            if (!/^\d+$/.test(raw)) return;
            const n = Math.min(100, Number(raw));
            setDraft(String(n));
            onChange(n);
          }}
          onBlur={() => commitDraft(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="m-pct-input"
        />
        <span className="m-pct-suffix">%</span>
      </label>
    </div>
  );
}



export function SettingsView() {

  const [app, setApp] = useState<Record<string, unknown>>({});

  const [activity, setActivity] = useState<{ crank_enabled: boolean; posting_enabled: boolean }>({
    crank_enabled: true,
    posting_enabled: true,
  });
  const [postingWarmup, setPostingWarmup] = useState<PostingWarmupSettings>(DEFAULT_POSTING_WARMUP);
  const [postingWarmupStatus, setPostingWarmupStatus] = useState<PostingWarmupStatusRow[]>([]);
  const [postingWarmupStatusLoading, setPostingWarmupStatusLoading] = useState(true);



  const load = useCallback(() => {
    setPostingWarmupStatusLoading(true);

    Promise.all([
      api.getSetting('app_settings').catch(() => ({})),
      api.getSetting('activity_control').catch(() => ({ crank_enabled: true, posting_enabled: true })),
      api.getPostingWarmupStatus().catch(() => ({ accounts: [] as PostingWarmupStatusRow[] })),
    ]).then(([a, act, warmupRes]) => {

      const appSettings = a as Record<string, unknown>;

      const legacyMedia = Boolean(appSettings.higgsfield_api ?? appSettings.elevenlabs_tts ?? appSettings.clova_tts ?? true);

      if (appSettings.claude_haiku_api === undefined) appSettings.claude_haiku_api = appSettings.claude_api ?? true;

      if (appSettings.google_imagen_api === undefined) appSettings.google_imagen_api = legacyMedia;

      if (appSettings.higgsfield_api === undefined) appSettings.higgsfield_api = legacyMedia;

      if (appSettings.claude_api === undefined) appSettings.claude_api = true;

      delete appSettings.gemini_api;

      delete appSettings.elevenlabs_tts;

      delete appSettings.clova_tts;

      setApp(appSettings);
      setPostingWarmup(normalizePostingWarmup(appSettings.posting_warmup));

      const actRow = act as { crank_enabled?: boolean; posting_enabled?: boolean };
      setActivity({
        crank_enabled: actRow.crank_enabled !== false,
        posting_enabled: actRow.posting_enabled !== false,
      });
      setPostingWarmupStatus(warmupRes.accounts ?? []);
    }).finally(() => {
      setPostingWarmupStatusLoading(false);
    });

  }, []);



  useEffect(() => {

    load();

  }, [load]);



  const patchApp = async (key: string, val: boolean) => {

    const next = { ...app, [key]: val };

    setApp(next);

    await api.updateSetting('app_settings', next);

  };



  const patchActivity = async (key: 'crank_enabled' | 'posting_enabled', val: boolean) => {
    const next = { ...activity, [key]: val };
    setActivity(next);
    await api.updateSetting('activity_control', next);
  };

  const warmupSum = postingWarmup.skip_pct + postingWarmup.light_pct + postingWarmup.full_pct;

  const patchPostingWarmup = async (key: keyof PostingWarmupSettings, val: number) => {
    const nextWarmup = { ...postingWarmup, [key]: val };
    setPostingWarmup(nextWarmup);
    const nextApp = { ...app, posting_warmup: nextWarmup };
    setApp(nextApp);
    await api.updateSetting('app_settings', nextApp);
  };



  return (

    <div className="animate-fadeIn">

      <MGrid cols={2}>

        <MPanel title="활동">
          <SettingsToggle
            label="C-Rank 활동"
            sub="OFF — 스케줄·수동 C-Rank 큐 생성·실행 중지 (전체 재개와 별도)"
            value={activity.crank_enabled}
            onChange={(v) => patchActivity('crank_enabled', v)}
          />
          <SettingsToggle
            label="포스팅 활동"
            sub="OFF — AI 생성·네이버 발행 큐 생성·실행 중지"
            value={activity.posting_enabled}
            onChange={(v) => patchActivity('posting_enabled', v)}
          />
          <PostingWarmupStatusPanel rows={postingWarmupStatus} loading={postingWarmupStatusLoading} />
        </MPanel>

        <MPanel title="API 연결">

          <SettingsToggle

            label="Claude API (Sonnet 4.6)"

            sub="콘텐츠·댓글·시나리오 생성 (메인)"

            value={Boolean(app.claude_api ?? true)}

            onChange={(v) => patchApp('claude_api', v)}

          />

          <SettingsToggle

            label="Claude Haiku 4.5"

            sub="이미지 모델 자동 판단·해시태그·autoDecide"

            value={Boolean(app.claude_haiku_api ?? true)}

            onChange={(v) => patchApp('claude_haiku_api', v)}

          />

          <SettingsToggle

            label="Google Imagen 4 API"

            badge="Gemini 키 공유"

            badgeTone="google"

            sub="이미지 생성 · Fast $0.02 / Standard $0.04"

            value={Boolean(app.google_imagen_api ?? true)}

            onChange={(v) => patchApp('google_imagen_api', v)}

          />

          <SettingsToggle

            label="Higgsfield Cloud API"

            badge="영상 전용"

            sub="영상 생성 · Kling 3.0 $1.05 / Seedance 2.0 Std $3.75 · 15초 · 내장 오디오"

            value={Boolean(app.higgsfield_api ?? true)}

            onChange={(v) => patchApp('higgsfield_api', v)}

          />

          <SettingsToggle

            label="Slack Webhook"

            sub="#huma-alerts · Fail-Safe 알림"

            value={Boolean(app.slack_webhook ?? true)}

            onChange={(v) => patchApp('slack_webhook', v)}

          />

        </MPanel>

        <MPanel title="포스팅 워밍업">
          <p className="mb-3 text-[11px] leading-relaxed text-huma-t3">
            post_blog 로그인 전 네이버 검색·체류 횟수 확률. 세 값 합계는 100% 권장.
          </p>
          <SettingsPercentRow
            label="워밍업 없이 바로 로그인"
            sub="0회 — 검색 생략 후 로그인"
            value={postingWarmup.skip_pct}
            onChange={(v) => void patchPostingWarmup('skip_pct', v)}
          />
          <SettingsPercentRow
            label="1~2회 워밍업"
            sub="네이버 검색·링크 체류 1~2라운드"
            value={postingWarmup.light_pct}
            onChange={(v) => void patchPostingWarmup('light_pct', v)}
          />
          <SettingsPercentRow
            label="2~3회 워밍업"
            sub="네이버 검색·링크 체류 2~3라운드"
            value={postingWarmup.full_pct}
            onChange={(v) => void patchPostingWarmup('full_pct', v)}
          />
          <div
            className={cn(
              'mt-2 font-mono text-[11px]',
              warmupSum === 100 ? 'text-huma-ok' : 'text-huma-warn',
            )}
          >
            합계: {warmupSum}% {warmupSum !== 100 ? '(100%가 아니면 비율로 정규화됨)' : ''}
          </div>
        </MPanel>

        <MPanel title="발행 제한">

          <SettingsToggle

            label="일일 발행 한도 (네이버 10건)"

            value={Boolean(app.daily_limit ?? true)}

            onChange={(v) => patchApp('daily_limit', v)}

          />

          <SettingsToggle

            label="야간 발행 금지 (01~07시)"

            value={Boolean(app.night_ban ?? true)}

            onChange={(v) => patchApp('night_ban', v)}

          />

        </MPanel>

      </MGrid>

    </div>

  );

}



export function WatcherView() {

  const [watcher, setWatcher] = useState<Record<string, unknown>>({});

  const [logs, setLogs] = useState<WatcherLogRow[]>([]);

  const load = useCallback(() => {

    Promise.all([api.getSetting('watcher'), api.logs({ level: 'ERROR', limit: '50' })])

      .then(([w, l]) => {

        setWatcher(w);

        setLogs(l as WatcherLogRow[]);
        refreshNavBadges();

      })

      .catch(() => {});

  }, []);



  useEffect(() => {

    load();

  }, [load]);

  useRegisterPageAction('refreshWatcher', load);



  const patch = async (key: string, val: boolean) => {

    const next = { ...watcher, [key]: val };

    setWatcher(next);

    await api.updateSetting('watcher', next);

  };

  const watcherErrorLogs = logs.filter(isWatcherRealtimeErrorLog);
  const layer4Logs = watcherErrorLogs.filter(isLayer4FailSafeLog);
  const otherErrors = watcherErrorLogs.length - layer4Logs.length;

  const rows = layer4Logs.slice(0, 8).map((l) => {
    const type = classifyWatcherLogType(l);
    return [
      <span key="t" className="font-mono whitespace-nowrap text-[11px]">
        {formatLogKst(String(l.created_at ?? ''))}
      </span>,
      resolveWatcherLogService(l),
      <span key="e" className={cn('m-tag', watcherLogTypeTagClass(type))}>
        {type}
      </span>,
      layer4ActionLabel(l),
      <span key="s" className="m-tag m-tag-ok">
        전송됨
      </span>,
      <span key="r" className="m-tag m-tag-warn">
        복구 대기
      </span>,
    ];
  });



  return (

    <div className="animate-fadeIn min-w-0">

      <MPanel title="Fail-Safe 설정" className="min-w-0">

        <MGrid cols={2} className="mb-0 items-stretch">

          <SettingsToggle

            label="캡차 감지 즉시 중지"

            sub="CAPTCHA가 뜨면 해당 계정의 발행·소통 job을 바로 멈춥니다."

            value={Boolean(watcher.auto_pause ?? true)}

            onChange={(v) => patch('auto_pause', v)}

          />

          <SettingsToggle

            label="Slack Webhook 알림"

            sub="Layer4(CAPTCHA·429 등) 감지 시 Slack #huma-alerts로 즉시 알립니다."

            value={Boolean(watcher.captcha_slack ?? true)}

            onChange={(v) => patch('captcha_slack', v)}

          />

          <SettingsToggle

            label="429 쿨다운 자동 대기"

            sub="네이버 429(과다 요청) 후 15분간 재시도하지 않고 자동으로 쉽니다."

            value={Boolean(watcher.cooldown_auto ?? true)}

            onChange={(v) => patch('cooldown_auto', v)}

          />

          <SettingsToggle

            label="점진적 복구 스케줄"

            sub="중지 후 12분 → 30분 → 2시간 간격으로 활동을 조금씩 다시 켭니다."

            value={Boolean(watcher.gradual_recovery ?? true)}

            onChange={(v) => patch('gradual_recovery', v)}

          />

        </MGrid>

      </MPanel>

      <MGrid cols={3}>

        <div className="m-sc">

          <div className="m-sc-l">감지 (오늘)</div>

          <div className="m-sc-v err">{layer4Logs.length}</div>

          <div className="m-sc-s">CAPTCHA · 429 · 휴식</div>

        </div>

        <div className="m-sc">

          <div className="m-sc-l">기타 ERROR</div>

          <div className="m-sc-v warn">{otherErrors}</div>

          <div className="m-sc-s">동글 · 워밍업 · 타임아웃 등</div>

        </div>

        <div className="m-sc">

          <div className="m-sc-l">Slack 알림</div>

          <div className="m-sc-v ok">ON</div>

          <div className="m-sc-s">#huma-alerts</div>

        </div>

      </MGrid>

      <MPanel title="Fail-Safe 감지 이력 (Layer4만)" className="min-w-0">

        {rows.length ? (

          <div className="watcher-history-scroll max-w-full overflow-x-auto">

            <table className="m-tbl m-tbl-watcher min-w-[520px]">

              <thead>

                <tr>

                  {['시각', '서비스', '유형', '조치', 'Slack', '복구'].map((h) => (

                    <th key={h}>{h}</th>

                  ))}

                </tr>

              </thead>

              <tbody>

                {rows.map((row, i) => (

                  <tr key={i}>

                    {row.map((cell, j) => (

                      <td key={j}>{cell}</td>

                    ))}

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        ) : (

          <div className="py-6 text-center text-sm text-huma-t3">오늘 Layer4 탐지 없음</div>

        )}

      </MPanel>

      <MPanel title="실시간 로그 (전체 ERROR)" className="min-w-0 overflow-hidden">

        <p className="mb-2 text-[11px] text-huma-t3">
          Layer4 CAPTCHA/429만 Fail-Safe 대상입니다. 숏폼 영상(콘티·EvoLink·렌더) 운영 로그는 제외됩니다.
        </p>

        <div className="m-log-t tall min-w-0 max-w-full overflow-x-hidden overflow-y-auto">

          {watcherErrorLogs.map((l, i) => {
            const type = classifyWatcherLogType(l);
            const service = resolveWatcherLogService(l);
            return (
              <div key={i} className="mb-1.5 min-w-0 break-words leading-snug">

                <span className="mr-2 whitespace-nowrap font-mono text-[11px] text-[#5a7090]">
                  {formatLogKst(String(l.created_at ?? ''))}
                </span>

                <span className={cn('m-tag mr-1.5 align-middle text-[10px]', watcherLogTypeTagClass(type))}>
                  {type}
                </span>

                {service !== '—' ? (
                  <span className="mr-1.5 text-[11px] text-huma-t3">[{service}]</span>
                ) : null}

                <span className={String(l.level) === 'ERROR' ? 'text-huma-err' : 'text-huma-warn'}>
                  {formatWatcherLogMessage(l)}
                </span>

              </div>
            );
          })}

        </div>

      </MPanel>

    </div>

  );

}


