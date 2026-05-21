import { AppShell } from '@/components/dashboard/app-shell';
import { HumanEngineSettings } from '@/components/dashboard/human-engine-settings';

export default function HumanEnginePage() {
  return (
    <AppShell>
      <HumanEngineSettings />
    </AppShell>
  );
}
