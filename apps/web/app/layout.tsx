import type { Metadata } from 'next';
import { Bebas_Neue, JetBrains_Mono, Noto_Sans_KR } from 'next/font/google';
import { Providers } from '@/components/dashboard/providers';
import './globals.css';

const noto = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '600'],
  variable: '--font-jetbrains',
});

const bebas = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-bebas',
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-ws="yeonun">
      <body className={`${noto.variable} ${jetbrains.variable} ${bebas.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
