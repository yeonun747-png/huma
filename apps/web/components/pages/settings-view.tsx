'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MGrid, MPanel, MStat, MTable, MTag, MToggle } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

export function SettingsView() {
  const [app, setApp] = useState<Record<string, unknown>>({});
  const [watcher, setWatcher] = useState<Record<string, unknown>>({});

  const load = useCallback(() => {
    Promise.all([
      api.getSetting('app_settings').catch(() => ({})),
      api.getSetting('watcher').catch(() => ({})),
    ]).then(([a, w]) => {
      const appSettings = a as Record<string, unknown>;
      if (appSettings.elevenlabs_tts === undefined && appSettings.clova_tts !== undefined) {
        appSettings.elevenlabs_tts = appSettings.clova_tts;
        delete appSettings.clova_tts;
      }
      setApp(appSettings);
      setWatcher(w as Record<string, unknown>);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

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
          <MToggle label="Claude API (Sonnet 4.5)" sub="콘텐츠·댓글·시나리오 생성" value={Boolean(app.claude_api ?? true)} onChange={(v) => patchApp('claude_api', v)} />
          <MToggle label="Gemini Pro (Google)" sub="병렬 백그라운드 생성" value={Boolean(app.gemini_api ?? true)} onChange={(v) => patchApp('gemini_api', v)} />
          <MToggle label="ElevenLabs TTS" sub="Higgsfield · 영상 음성 합성 (v3)" value={Boolean(app.elevenlabs_tts ?? true)} onChange={(v) => patchApp('elevenlabs_tts', v)} />
          <MToggle label="Slack Webhook" sub="#huma-alerts · Fail-Safe 알림" value={Boolean(app.slack_webhook ?? true)} onChange={(v) => patchApp('slack_webhook', v)} />
        </MPanel>
        <MPanel title="발행 제한">
          <MToggle label="일일 발행 한도 (네이버 30건)" value={Boolean(app.daily_limit ?? true)} onChange={(v) => patchApp('daily_limit', v)} />
          <MToggle label="야간 발행 금지 (01~07시)" value={Boolean(app.night_ban ?? true)} onChange={(v) => patchApp('night_ban', v)} />
          <MToggle label="Layer4 자동 일시정지" value={Boolean(watcher.auto_pause ?? true)} onChange={(v) => patchWatcher('auto_pause', v)} />
          <MToggle label="점진적 복구 스케줄" value={Boolean(watcher.gradual_recovery ?? true)} onChange={(v) => patchWatcher('gradual_recovery', v)} />
        </MPanel>
      </MGrid>
    </div>
  );
}

export function WatcherView() {
  const [watcher, setWatcher] = useState<Record<string, unknown>>({});
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);

  const load = useCallback(() => {
    Promise.all([
      api.getSetting('watcher'),
      api.logs({ level: 'ERROR', limit: '20' }),
    ]).then(([w, l]) => {
      setWatcher(w);
      setLogs(l);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useRegisterPageAction('refreshWatcher', load);

  const patch = async (key: string, val: boolean) => {
    const next = { ...watcher, [key]: val };
    setWatcher(next);
    await api.updateSetting('watcher', next);
  };

  const rows = logs.slice(0, 5).map((l) => [
    <span key="t" className="font-mono">{String(l.created_at ?? '').slice(11, 16)}</span>,
    String(l.workspace ?? '—'),
    <MTag tone="err">{String(l.level ?? 'ERROR')}</MTag>,
    '즉시 중지',
    <MTag tone="ok">전송됨</MTag>,
    <MTag tone="warn">복구중</MTag>,
  ]);

  return (
    <div className="animate-fadeIn">
      <MGrid cols={3}>
        <MStat label="감지 (오늘)" value={logs.length} tone="err" sub="캡차 · 429" />
        <MStat label="자동 복구" value={2} tone="ok" sub="1건 진행중" />
        <MStat label="Slack 알림" value="ON" tone="ok" sub="#huma-alerts" />
      </MGrid>
      <MPanel title="Fail-Safe 감지 이력">
        {rows.length ? <MTable head={['시각', '서비스', '유형', '조치', 'Slack', '복구']} rows={rows} /> : <div className="py-6 text-center text-sm text-huma-t3">감지 이력 없음</div>}
      </MPanel>
      <MGrid cols={2}>
        <MPanel title="Fail-Safe 설정">
          <MToggle label="캡차 감지 즉시 중지" sub="탐지 시 해당 계정 즉시 일시정지" value={Boolean(watcher.auto_pause ?? true)} onChange={(v) => patch('auto_pause', v)} />
          <MToggle label="Slack Webhook 알림" sub="#huma-alerts · 실시간" value={Boolean(watcher.captcha_slack ?? true)} onChange={(v) => patch('captcha_slack', v)} />
          <MToggle label="429 쿨다운 자동 대기" sub="감지 후 15분 대기 후 재시도" value={Boolean(watcher.cooldown_auto ?? true)} onChange={(v) => patch('cooldown_auto', v)} />
          <MToggle label="점진적 복구 스케줄" sub="12분 → 30분 → 2시간 단계 복구" value={Boolean(watcher.gradual_recovery ?? true)} onChange={(v) => patch('gradual_recovery', v)} />
        </MPanel>
        <MPanel title="실시간 로그">
          <div className="m-log-t tall">
            {logs.map((l, i) => (
              <div key={i}>
                <span className="text-[#5a7090] mr-2">{String(l.created_at ?? '').slice(11, 16)}</span>
                <span className={String(l.level) === 'ERROR' ? 'text-huma-err' : 'text-huma-warn'}>[{String(l.level)}]</span>{' '}
                {String(l.message ?? '')}
              </div>
            ))}
          </div>
        </MPanel>
      </MGrid>
    </div>
  );
}
