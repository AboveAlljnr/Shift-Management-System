'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Building2, Eye, EyeOff, Check } from 'lucide-react';

import { apiClient } from '@/lib/api/client';
import { setAuthTokens } from '@/lib/auth';
import type { AuthTokens } from '@sms/shared';

interface LoginResponse {
  data: AuthTokens;
  message?: string;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companySlug, setCompanySlug] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) return setError('Email is required');
    if (password.length < 8) return setError('Password must be at least 8 characters');

    setLoading(true);
    try {
      const { data } = await apiClient.post<LoginResponse>('/auth/login', {
        email,
        password,
        companySlug: companySlug.trim() || undefined,
      });
      setAuthTokens(data.data);
      router.replace(from as Route);
      router.refresh();
    } catch (err) {
      const axiosError = err as { response?: { data?: { message?: string | string[] } } };
      const message = axiosError.response?.data?.message;
      setError(Array.isArray(message) ? (message[0] ?? 'Unable to sign in. Please try again.') : message ?? 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full px-4 py-3 bg-slate-800/60 border border-slate-700 rounded-xl text-white placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand transition';

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left panel (desktop) */}
      <div className="hidden lg:flex flex-col w-[480px] bg-[#0F172A] border-r border-slate-800 p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 rounded-full bg-brand blur-3xl" />
          <div className="absolute bottom-20 right-10 w-48 h-48 rounded-full bg-[#7C3AED] blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center">
              <Building2 size={18} color="white" />
            </div>
            <span className="text-white font-bold text-lg font-sans">WorkForce</span>
          </div>
          <h2 className="text-4xl font-bold text-white mb-4 leading-tight font-sans">
            Organize your workforce. Smarter.
          </h2>
          <p className="text-slate-400 text-base leading-relaxed mb-12">
            Schedule smarter, track attendance in real time, and manage your entire workforce
            from a single platform.
          </p>
          <div className="space-y-4">
            {[
              'Scheduling conflict prevention',
              'Multi-location management',
              'Real-time attendance tracking',
              'Leave & availability management',
            ].map((f) => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0">
                  <Check size={12} className="text-brand" />
                </div>
                <span className="text-slate-300 text-sm">{f}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 mt-auto">
          <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-[#7C3AED] flex items-center justify-center text-white text-xs font-bold">
                SJ
              </div>
              <div>
                <p className="text-white text-xs font-semibold">Sarah Johnson</p>
                <p className="text-slate-400 text-xs">Front Desk Supervisor</p>
              </div>
            </div>
            <p className="text-slate-300 text-xs leading-relaxed italic">
              &ldquo;Scheduling used to take my whole Sunday. Now I do it in minutes.&rdquo;
            </p>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-950">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center">
              <Building2 size={16} color="white" />
            </div>
            <span className="text-white font-bold font-sans">WorkForce</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1 font-sans">Welcome back</h1>
          <p className="text-slate-400 text-sm mb-8">Sign in to your account to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="companySlug" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Company slug <span className="normal-case text-slate-500">(optional)</span>
              </label>
              <input
                id="companySlug"
                type="text"
                value={companySlug}
                onChange={(e) => setCompanySlug(e.target.value)}
                placeholder="acme-corp"
                className={inputClass}
              />
              <p className="text-xs text-slate-500 mt-1.5">Required if you belong to multiple companies.</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Password
                </label>
                <span className="text-xs text-slate-500">At least 8 characters</span>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`${inputClass} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer p-1"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand hover:bg-brand-dark text-white font-semibold rounded-xl text-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-slate-500 text-xs mt-6">
            New to WorkForce?{' '}
            <Link href="/register" className="text-brand hover:underline font-medium">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
