import { AppShell } from '@/components/dashboard/app-shell';
import { VideoPipelineList } from '@/components/video/video-pipeline-list';

export default function VideoPipelinePage() {
  return (
    <AppShell title="영상 파이프라인">
      <VideoPipelineList />
    </AppShell>
  );
}
