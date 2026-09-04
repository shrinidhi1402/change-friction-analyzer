'use client';

import { useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.message || 'Login failed');
        return;
      }

      const data = await response.json();
      login(data.token, data.user);
      router.push('/dashboard');
    } catch {
      setError('Unable to reach API server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6 text-[#2E282A]">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch border border-[#E6E1D8] bg-white rounded-2xl p-4 md:p-8 shadow-sm">
        
        {/* LEFT COLUMN: Compact Product Intro */}
        <div className="md:col-span-6 bg-[#F4F0EA] border border-[#E6E1D8] rounded-xl p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-lg bg-[#FF6B35] flex items-center justify-center text-white font-bold text-lg shadow-sm">
                CF
              </div>
              <span className="font-bold text-base tracking-tight text-[#2E282A]">Change Friction</span>
            </div>

            <h1 className="text-2xl font-bold text-[#2E282A] tracking-tight mb-4">
              Know what could break before you change code.
            </h1>

            <p className="text-sm text-[#6B6265] leading-relaxed">
              Change Friction Analyzer shows you which files are risky to change.
              It uses code dependencies and Git history to explain where a change may have wider impact.
            </p>
          </div>

          <div className="pt-8 border-t border-[#E6E1D8]/70 mt-8">
            <div className="flex items-center gap-2 text-xs font-medium text-[#6B6265]">
              <span className="w-2 h-2 rounded-full bg-[#2B8A3E]"></span>
              <span>Engineering Intelligence Platform</span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Auth Form */}
        <div className="md:col-span-6 p-4 md:p-6 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-[#2E282A] tracking-tight">Sign in</h2>
            <p className="text-xs text-[#6B6265] mt-1">Enter your credentials to access your dashboard</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6265] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                className="w-full rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] px-3.5 py-2.5 text-sm text-[#2E282A] placeholder-[#9E9497] focus:border-[#FF6B35] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#FF6B35] transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B6265] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] px-3.5 py-2.5 text-sm text-[#2E282A] placeholder-[#9E9497] focus:border-[#FF6B35] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#FF6B35] transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-[#FF6B35] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#E05A2B] transition-colors disabled:opacity-50 mt-2 shadow-sm"
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {error && (
            <div className="mt-4 p-3 rounded-lg border border-[#FFC9C9] bg-[#FFE3E3] text-xs font-medium text-[#EF5B5B]">
              {error}
            </div>
          )}

          <p className="mt-6 text-xs text-[#6B6265] text-center">
            Need an account?{' '}
            <Link href="/register" className="font-semibold text-[#FF6B35] hover:text-[#E05A2B] transition-colors">
              Create an account
            </Link>
          </p>
        </div>

      </div>
    </main>
  );
}
