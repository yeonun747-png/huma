import Link from 'next/link';
import type { ReactNode } from 'react';

export function LegalPageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-huma-bg text-huma-t">
      <header className="border-b border-huma-bdr bg-huma-bg2 px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <Link href="/" className="font-display text-xl tracking-[0.15em] text-huma-acc">
              HUMA
            </Link>
            <p className="mt-0.5 font-mono text-[10px] text-huma-t3">{title}</p>
          </div>
          <Link
            href="/login"
            className="shrink-0 rounded-md border border-huma-bdr px-3 py-1.5 font-mono text-[11px] text-huma-t2 hover:border-huma-acc hover:text-huma-acc"
          >
            로그인
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="border-t border-huma-bdr2 px-4 py-6">
        <nav className="mx-auto flex max-w-3xl flex-wrap gap-4 font-mono text-[11px] text-huma-t3">
          <Link href="/privacy" className="hover:text-huma-acc">
            개인정보처리방침
          </Link>
          <Link href="/terms" className="hover:text-huma-acc">
            이용약관
          </Link>
          <Link href="/" className="hover:text-huma-acc">
            HUMA Studio
          </Link>
        </nav>
      </footer>
    </div>
  );
}
