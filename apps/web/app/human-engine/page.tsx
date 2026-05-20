import { AppShell } from '@/components/dashboard/app-shell';
import { HumanEngineSettings } from '@/components/dashboard/human-engine-settings';

export default function HumanEnginePage() {
  return (
    <AppShell title="휴먼 엔진 설정">
      <HumanEngineSettings />
    </AppShell>
  );
}
