'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function HumanEngineSettings() {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSetting('human_engine').then((v) => setConfig(v)).catch(() => {});
  }, []);

  const save = async () => {
    await api.updateSetting('human_engine', config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const fields = [
    { key: 'wpm_mean', label: 'WPM 평균' },
    { key: 'wpm_sigma', label: 'WPM 표준편차' },
    { key: 'typo_rate', label: '오타율', step: 0.01 },
    { key: 'night_ban_start', label: '야간 금지 시작 (시)' },
    { key: 'night_ban_end', label: '야간 금지 종료 (시)' },
  ];

  return (
    <div className="panel animate-fadeIn max-w-lg space-y-3">
      <div className="panel-title">휴먼 엔진 설정</div>
      {fields.map((f) => (
        <div key={f.key} className="flex items-center justify-between border-b border-huma-bdr2 py-2">
          <span className="text-xs text-huma-t2">{f.label}</span>
          <input
            type="number"
            step={f.step ?? 1}
            value={Number(config[f.key] ?? '')}
            onChange={(e) => setConfig({ ...config, [f.key]: parseFloat(e.target.value) })}
            className="w-20 rounded border border-huma-bdr bg-huma-bg3 px-2 py-1 text-right font-mono text-xs text-huma-t"
          />
        </div>
      ))}
      <button type="button" className="btn-primary" onClick={save}>{saved ? '저장됨 ✓' : '저장'}</button>
    </div>
  );
}
