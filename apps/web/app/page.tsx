import type { Metadata } from 'next';
import { PublicLanding } from '@/components/pages/public-landing';

export const metadata: Metadata = {
  title: 'HUMA Studio — Human Automation Platform',
  description:
    'HUMA Studio는 romang-ai.com 운영을 위한 내부 관리자 플랫폼입니다. 멀티플랫폼 콘텐츠 발행·스케줄·모니터링·SEO·AdSense 수익 분석을 제공합니다.',
  openGraph: {
    title: 'HUMA Studio — Human Automation Platform',
    description:
      'romang-ai.com 운영을 위한 멀티플랫폼 자동 발행·관리 플랫폼. 승인된 관리자만 이용 가능합니다.',
  },
};

export default function HomePage() {
  return <PublicLanding />;
}
