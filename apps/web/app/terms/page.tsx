import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/legal-page-shell';
import { TermsDocContent } from '@/components/legal/legal-doc-content';

export const metadata: Metadata = {
  title: '이용약관 | HUMA Studio',
  description: 'HUMA Studio 이용약관',
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPageShell title="이용약관">
      <TermsDocContent />
    </LegalPageShell>
  );
}
