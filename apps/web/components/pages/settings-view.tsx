'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/constants';
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

  const load = useCallback(() => {
    Promise.all([
      api.getSetting('app_settings').catch(() => ({})),
      api.getSetting('watcher').catch(() => ({})),
    ]).then(([a, w]) => {
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
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRegisterPageAction('saveSettings', async () => {
    await Promise.all([
      api.updateSetting('app_settings', app),
      api.updateSetting('watcher', watcher),
    ]);
  });

  const patchApp = (key: string, val: boolean) => setApp((a) => ({ ...a, [key]: val }));
  const patchWatcher = (key: string, val: boolean) => setWatcher((w) => ({ ...w, [key]: val }));

  return (
    <div className="animate-fadeIn">
      <MGrid cols={2}>
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
            sub="Kling 3.0 종량제 · $1.20/15초"
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
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);

  const load = useCallback(() => {
    Promise.all([api.getSetting('watcher'), api.logs({ level: 'ERROR', limit: '20' })])
      .then(([w, l]) => {
        setWatcher(w);
        setLogs(l);
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

  const rows = logs.slice(0, 5).map((l) => [
    <span key="t" className="font-mono">
      {String(l.created_at ?? '').slice(11, 16)}
    </span>,
    String(l.workspace ?? '—'),
    <span key="e" className="m-tag m-tag-err">
      {String(l.level ?? 'ERROR')}
    </span>,
    '즉시 중지',
    <span key="s" className="m-tag m-tag-ok">
      전송됨
    </span>,
    <span key="r" className="m-tag m-tag-warn">
      복구중
    </span>,
  ]);

  return (
    <div className="animate-fadeIn">
      <MGrid cols={3}>
        <div className="m-sc">
          <div className="m-sc-l">감지 (오늘)</div>
          <div className="m-sc-v err">{logs.length}</div>
          <div className="m-sc-s">캡차 · 429</div>
        </div>
        <div className="m-sc">
          <div className="m-sc-l">자동 복구</div>
          <div className="m-sc-v ok">2</div>
          <div className="m-sc-s">1건 진행중</div>
        </div>
        <div className="m-sc">
          <div className="m-sc-l">Slack 알림</div>
          <div className="m-sc-v ok">ON</div>
          <div className="m-sc-s">#huma-alerts</div>
        </div>
      </MGrid>
      <MPanel title="Fail-Safe 감지 이력">
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
          <div className="py-6 text-center text-sm text-huma-t3">감지 이력 없음</div>
        )}
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
        <MPanel title="실시간 로그">
          <div className="m-log-t tall">
            {logs.map((l, i) => (
              <div key={i}>
                <span className="text-[#5a7090] mr-2">{String(l.created_at ?? '').slice(11, 16)}</span>
                <span className={String(l.level) === 'ERROR' ? 'text-huma-err' : 'text-huma-warn'}>
                  [{String(l.level)}]
                </span>{' '}
                {String(l.message ?? '')}
              </div>
            ))}
          </div>
        </MPanel>
      </MGrid>
    </div>
  );
}
