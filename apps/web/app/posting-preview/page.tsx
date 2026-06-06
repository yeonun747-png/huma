import { PostingPreviewClient } from '@/components/posting/posting-preview-client';

export default function PostingPreviewPage({
  searchParams,
}: {
  searchParams: { jobId?: string };
}) {
  const jobId = searchParams.jobId?.trim();
  if (!jobId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-huma-bg2 text-sm text-huma-err">
        jobId 쿼리가 필요합니다. 큐 관리에서 「검증 미리보기」로 다시 열어주세요.
      </div>
    );
  }
  return <PostingPreviewClient jobId={jobId} />;
}
