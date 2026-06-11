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
  layer4ActionLabel,
  resolveWatcherLogService,
  watcherLogTypeTagClass,
  type WatcherLogRow,
} from '@/lib/watcher-log-label';

import { MGrid, MPanel } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';



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



export function SettingsView() {

  const [app, setApp] = useState<Record<string, unknown>>({});

  const [watcher, setWatcher] = useState<Record<string, unknown>>({});

  const [activity, setActivity] = useState<{ crank_enabled: boolean; posting_enabled: boolean }>({
    crank_enabled: true,
    posting_enabled: true,
  });



  const load = useCallback(() => {

    Promise.all([

      api.getSetting('app_settings').catch(() => ({})),

      api.getSetting('watcher').catch(() => ({})),

      api.getSetting('activity_control').catch(() => ({ crank_enabled: true, posting_enabled: true })),

    ]).then(([a, w, act]) => {

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

      setWatcher(w as Record<string, unknown>);

      const actRow = act as { crank_enabled?: boolean; posting_enabled?: boolean };
      setActivity({
        crank_enabled: actRow.crank_enabled !== false,
        posting_enabled: actRow.posting_enabled !== false,
      });

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



  const patchWatcher = async (key: string, val: boolean) => {

    const next = { ...watcher, [key]: val };

    setWatcher(next);

    await api.updateSetting('watcher', next);

  };

  const patchActivity = async (key: 'crank_enabled' | 'posting_enabled', val: boolean) => {
    const next = { ...activity, [key]: val };
    setActivity(next);
    await api.updateSetting('activity_control', next);
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

        <MPanel title="발행 제한">

          <SettingsToggle

            label="일일 발행 한도 (네이버 30건)"

            value={Boolean(app.daily_limit ?? true)}

            onChange={(v) => patchApp('daily_limit', v)}

          />

          <SettingsToggle

            label="야간 발행 금지 (01~07시)"

            value={Boolean(app.night_ban ?? true)}

            onChange={(v) => patchApp('night_ban', v)}

          />

          <SettingsToggle

            label="Layer4 자동 일시정지"

            value={Boolean(watcher.auto_pause ?? true)}

            onChange={(v) => patchWatcher('auto_pause', v)}

          />

          <SettingsToggle

            label="점진적 복구 스케줄"

            value={Boolean(watcher.gradual_recovery ?? true)}

            onChange={(v) => patchWatcher('gradual_recovery', v)}

          />

        </MPanel>

      </MGrid>

    </div>

  );

}



export function WatcherView() {

  const [watcher, setWatcher] = useState<Record<string, unknown>>({});

  const [logs, setLogs] = useState<WatcherLogRow[]>([]);
  const [drillJobId, setDrillJobId] = useState<string | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [telegramTestLoading, setTelegramTestLoading] = useState(false);
  const [vncCheckLoading, setVncCheckLoading] = useState(false);

  const loadDrill = useCallback(() => {
    api
      .getCaptchaDrillStatus()
      .then((s) => setDrillJobId(s.activeJobId))
      .catch(() => setDrillJobId(null));
  }, []);

  const load = useCallback(() => {

    Promise.all([api.getSetting('watcher'), api.logs({ level: 'ERROR', limit: '50' })])

      .then(([w, l]) => {

        setWatcher(w);

        setLogs(l as WatcherLogRow[]);
        refreshNavBadges();

      })

      .catch(() => {});

    loadDrill();

  }, [loadDrill]);



  useEffect(() => {

    load();

  }, [load]);

  useRegisterPageAction('refreshWatcher', load);



  const patch = async (key: string, val: boolean) => {

    const next = { ...watcher, [key]: val };

    setWatcher(next);

    await api.updateSetting('watcher', next);

  };

  const startDrill = async (workspace: 'yeonun' | 'panana' | 'quizoasis') => {
    if (!window.confirm(`${workspace} CAPTCHA 연습을 시작할까요?\nTelegram · VNC · 큐 발행완료 UI (5분, 실발행 아님)`)) {
      return;
    }
    setDrillLoading(true);
    try {
      const r = await api.startCaptchaDrill(workspace);
      setDrillJobId(r.jobId);
      const tg = r.telegram;
      const tgLine = tg.ok
        ? 'Telegram: 발송 OK'
        : `Telegram: 실패 — ${tg.error ?? tg.skipped ?? 'unknown'} (token=${tg.env.hasToken ? 'Y' : 'N'}, chat=${tg.env.chatId ? 'Y' : 'N'})`;
      const vncLine = `VNC: ${r.browser.mode} · DISPLAY ${r.browser.display} — 밝은 흰/빨간 DRILL 화면이 보여야 함`;
      alert(`연습 job 생성됨\n\n${tgLine}\n${vncLine}\n\n큐에서 발행 완료까지 테스트하세요.`);
      window.open(`/queue?job=${encodeURIComponent(r.jobId)}`, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDrillLoading(false);
    }
  };

  const checkVnc = async () => {
    setVncCheckLoading(true);
    try {
      const s = await api.getVncStatus();
      alert(
        [
          `VNC ${s.listening && s.x11vnc ? 'OK' : '문제'}`,
          `port ${s.port} · DISPLAY ${s.display}`,
          `Xvfb: ${s.xvfb ? 'Y' : 'N'} · x11vnc: ${s.x11vnc ? 'Y' : 'N'} · DRILL: ${s.drillActive ? '진행 중' : '없음'}`,
          s.hint,
          s.vncUrlYeonun ? `\nenv: ${s.vncUrlYeonun}` : '',
        ].join('\n'),
      );
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setVncCheckLoading(false);
    }
  };

  const testTelegram = async (workspace: 'yeonun' | 'panana' | 'quizoasis') => {
    setTelegramTestLoading(true);
    try {
      const r = await api.testTelegram(workspace);
      alert(
        r.ok
          ? `${workspace} Telegram OK (@${r.botUsername ?? 'bot'}) — Telegram 앱에서 메시지 확인`
          : `Telegram 실패:\n${r.error ?? 'unknown'}\ntoken=${r.env.hasToken ? 'Y' : 'N'} chat=${r.env.chatId ? 'Y' : 'N'}`,
      );
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setTelegramTestLoading(false);
    }
  };



  const layer4Logs = logs.filter(isLayer4FailSafeLog);
  const otherErrors = logs.length - layer4Logs.length;

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

    <div className="animate-fadeIn">

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

      <MPanel title="Fail-Safe 감지 이력 (Layer4만)">

        {rows.length ? (

          <table className="m-tbl">

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

        ) : (

          <div className="py-6 text-center text-sm text-huma-t3">
            오늘 Layer4 탐지 없음 — 아래 실시간 로그는 전체 ERROR입니다
          </div>

        )}

      </MPanel>

      <MPanel title="CAPTCHA 연습 (DRILL)">
        <p className="mb-3 text-[12px] leading-relaxed text-huma-t2">
          Telegram 알림 · VNC 화면 · 큐 「발행 완료」 UI를 한 번에 테스트합니다. 실제 네이버 발행·Layer4 처리는 하지
          않습니다. i7에서 x11vnc가 떠 있어야 VNC에 DRILL 화면이 보입니다.
        </p>
        {drillJobId ? (
          <p className="mb-3 font-mono text-[11px] text-huma-warn">
            진행 중 job: {drillJobId}{' '}
            <a className="text-huma-accent underline" href={`/queue?job=${drillJobId}`}>
              큐 열기
            </a>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={drillLoading || Boolean(drillJobId)}
            onClick={() => void startDrill('yeonun')}
          >
            연운 DRILL
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={drillLoading || Boolean(drillJobId)}
            onClick={() => void startDrill('panana')}
          >
            파나나 DRILL
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={drillLoading || Boolean(drillJobId)}
            onClick={() => void startDrill('quizoasis')}
          >
            퀴즈 DRILL
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={drillLoading} onClick={() => loadDrill()}>
            상태 새로고침
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={telegramTestLoading}
            onClick={() => void testTelegram('yeonun')}
          >
            Telegram 테스트 (연운)
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={vncCheckLoading}
            onClick={() => void checkVnc()}
          >
            VNC 상태 (i7)
          </button>
        </div>
      </MPanel>

      <MGrid cols={2}>

        <MPanel title="Fail-Safe 설정">

          <SettingsToggle

            label="캡차 감지 즉시 중지"

            sub="탐지 시 해당 계정 즉시 일시정지"

            value={Boolean(watcher.auto_pause ?? true)}

            onChange={(v) => patch('auto_pause', v)}

          />

          <SettingsToggle

            label="Slack Webhook 알림"

            sub="#huma-alerts · 실시간"

            value={Boolean(watcher.captcha_slack ?? true)}

            onChange={(v) => patch('captcha_slack', v)}

          />

          <SettingsToggle

            label="429 쿨다운 자동 대기"

            sub="감지 후 15분 대기 후 재시도"

            value={Boolean(watcher.cooldown_auto ?? true)}

            onChange={(v) => patch('cooldown_auto', v)}

          />

          <SettingsToggle

            label="점진적 복구 스케줄"

            sub="12분 → 30분 → 2시간 단계 복구"

            value={Boolean(watcher.gradual_recovery ?? true)}

            onChange={(v) => patch('gradual_recovery', v)}

          />

        </MPanel>

        <MPanel title="실시간 로그 (전체 ERROR)">

          <p className="mb-2 text-[11px] text-huma-t3">
            Layer4 CAPTCHA/429만 Fail-Safe 대상입니다. 동글·워밍업·타임아웃은 별도 장애입니다.
          </p>

          <div className="m-log-t tall">

            {logs.map((l, i) => {
              const type = classifyWatcherLogType(l);
              const service = resolveWatcherLogService(l);
              return (
              <div key={i} className="mb-1.5 leading-snug">

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

      </MGrid>

    </div>

  );

}


