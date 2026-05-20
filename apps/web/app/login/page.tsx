'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { login, token } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (token) {
    router.replace('/');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-huma-bg p-4">
      <form onSubmit={handleSubmit} className="panel w-full max-w-sm space-y-4" noValidate>
        <div>
          <div className="font-display text-3xl tracking-[0.2em] text-huma-acc">HUMA</div>
          <p className="mt-1 font-mono text-[10px] text-huma-t3">Studio · Human Automation</p>
        </div>
        <div>
          <label htmlFor="username" className="stat-label">아이디</label>
          <input
            id="username"
            name="username"
            type="text"
            inputMode="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-md border border-huma-bdr bg-huma-bg3 px-3 py-2 text-sm text-huma-t outline-none focus:border-huma-acc"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="stat-label">비밀번호</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-huma-bdr bg-huma-bg3 px-3 py-2 text-sm text-huma-t outline-none focus:border-huma-acc"
            required
          />
        </div>
        {error && <p className="text-xs text-huma-err">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full py-2">
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
