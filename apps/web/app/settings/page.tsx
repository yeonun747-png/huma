'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/dashboard/app-shell';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Array<{ key: string; value: unknown }>>([]);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => setSettings([]));
  }, []);

  return (
    <AppShell title="환경 설정">
      <div className="animate-fadeIn space-y-3">
        {settings.map((s) => (
          <div key={s.key} className="panel">
            <div className="panel-title">{s.key}</div>
            <pre className="overflow-x-auto font-mono text-[10px] text-huma-t2">{JSON.stringify(s.value, null, 2)}</pre>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
