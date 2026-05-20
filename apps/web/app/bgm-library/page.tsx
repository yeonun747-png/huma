import { AppShell } from '@/components/dashboard/app-shell';
import { BgmLibraryPanel } from '@/components/bgm/bgm-library-panel';

export default function BgmLibraryPage() {
  return (
    <AppShell title="BGM 라이브러리">
      <BgmLibraryPanel />
    </AppShell>
  );
}
