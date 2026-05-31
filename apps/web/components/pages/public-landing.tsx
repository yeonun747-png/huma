import Link from 'next/link';
import { LandingAuthRedirect } from '@/components/pages/landing-auth-redirect';

const SUPPORT_EMAIL = 'cmunj2025@gmail.com';

export function PublicLanding() {
  return (
    <div className="min-h-screen bg-huma-bg text-huma-t">
      <LandingAuthRedirect />
      <header className="border-b border-huma-bdr bg-huma-bg2 px-4 py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <p className="font-display text-2xl tracking-[0.15em] text-huma-acc">HUMA</p>
            <p className="mt-0.5 font-mono text-[10px] text-huma-t3">Studio · Human Automation Platform</p>
          </div>
          <Link
            href="/login"
            className="shrink-0 rounded-md border border-huma-acc bg-huma-acc/10 px-4 py-2 font-mono text-[11px] text-huma-acc hover:bg-huma-acc/20"
          >
            로그인
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <section className="space-y-4">
          <h1 className="font-display text-3xl tracking-wide text-huma-t">HUMA Studio</h1>
          <p className="text-sm leading-relaxed text-huma-t2">
            HUMA Studio는 romang-ai.com 운영을 위한 <strong className="font-medium text-huma-t">내부 관리자 플랫폼</strong>
            입니다. 네이버·소셜 등 멀티플랫폼 콘텐츠 발행, 큐·스케줄 관리, 발행 모니터링, SEO·수익 분석 등
            자동화 업무를 한곳에서 운영합니다.
          </p>
          <p className="font-mono text-[11px] text-huma-t3">
            본 서비스는 승인된 관리자 계정으로만 이용할 수 있습니다. 일반 사용자용 공개 서비스가 아닙니다.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-huma-t3">주요 기능</h2>
          <ul className="grid gap-2 text-sm text-huma-t2 sm:grid-cols-2">
            <li className="rounded-md border border-huma-bdr bg-huma-bg2 px-3 py-2">멀티 워크스페이스 발행 큐·스케줄</li>
            <li className="rounded-md border border-huma-bdr bg-huma-bg2 px-3 py-2">실시간 발행 모니터·Operation Log</li>
            <li className="rounded-md border border-huma-bdr bg-huma-bg2 px-3 py-2">소셜·영상 파이프라인 자동화</li>
            <li className="rounded-md border border-huma-bdr bg-huma-bg2 px-3 py-2">SEO 키워드·AdSense 수익 통계</li>
          </ul>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-huma-t3">Google API 사용</h2>
          <p className="text-sm leading-relaxed text-huma-t2">
            승인된 관리자가 Google AdSense 수익 통계를 확인할 때{' '}
            <code className="rounded bg-huma-bg3 px-1 py-0.5 font-mono text-[11px] text-huma-acc">
              adsense.readonly
            </code>{' '}
            범위를 사용합니다. OAuth를 통해 연결하며, 데이터는 HUMA Studio 관리 화면에서만 표시됩니다.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-huma-t3">문의</h2>
          <p className="text-sm text-huma-t2">
            서비스·개인정보·OAuth 관련 문의:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-huma-acc hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>

        <div className="mt-10">
          <Link href="/login" className="btn-primary inline-block px-6 py-2.5 text-sm">
            관리자 로그인
          </Link>
        </div>
      </main>

      <footer className="mt-12 border-t border-huma-bdr2 px-4 py-6">
        <nav className="mx-auto flex max-w-3xl flex-wrap gap-4 font-mono text-[11px] text-huma-t3">
          <Link href="/privacy" className="hover:text-huma-acc">
            개인정보처리방침
          </Link>
          <Link href="/terms" className="hover:text-huma-acc">
            이용약관
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-huma-acc">
            지원 문의
          </a>
        </nav>
      </footer>
    </div>
  );
}
