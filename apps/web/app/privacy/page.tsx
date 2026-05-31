import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/legal-page-shell';
import { PrivacyDocContent } from '@/components/legal/legal-doc-content';

export const metadata: Metadata = {
  title: '개인정보처리방침 | HUMA Studio',
  description: 'HUMA Studio 개인정보처리방침',
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPageShell title="개인정보처리방침">
      <PrivacyDocContent />
    </LegalPageShell>
  );
}
