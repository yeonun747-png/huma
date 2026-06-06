import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '포스팅 검증 미리보기 — HUMA',
};

export default function PostingPreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="posting-preview-root min-h-screen bg-[#e8e8e8]">
      {children}
    </div>
  );
}
