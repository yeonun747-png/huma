import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/dashboard/providers';
import './globals.css';

const pretendard = localFont({
  src: '../public/fonts/PretendardVariable.woff2',
  weight: '45 920',
  variable: '--font-pretendard',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://romang-ai.com';

export const metadata: Metadata = {
  title: 'HUMA Studio — Human Automation Platform',
  description: '네이버·소셜 멀티플랫폼 자동 발행 관리 플랫폼',
  metadataBase: new URL(siteUrl),
  icons: {
    icon: [{ url: '/f.png', type: 'image/png' }],
    shortcut: '/f.png',
    apple: '/f.png',
  },
  openGraph: {
    title: 'HUMA Studio — Human Automation Platform',
    description: '네이버·소셜 멀티플랫폼 자동 발행 관리 플랫폼',
    url: siteUrl,
    siteName: 'HUMA Studio',
    locale: 'ko_KR',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HUMA Studio' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HUMA Studio — Human Automation Platform',
    description: '네이버·소셜 멀티플랫폼 자동 발행 관리 플랫폼',
    images: ['/og.png'],
  },
  verification: {
    google: 'FOkVNz2tplVehJnLNNgEC3c9mxf5LFcMTd-yrCUUELQ',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-ws="yeonun" className={pretendard.variable}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
