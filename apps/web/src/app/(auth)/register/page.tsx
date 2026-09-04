'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Building2, Eye, EyeOff } from 'lucide-react';

import { apiClient } from '@/lib/api/client';
import { setAuthTokens } from '@/lib/auth';
import type { AuthTokens } from '@sms/shared';

interface RegisterResponse {
  data: AuthTokens;
  message?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companySlug, setCompanySlug] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleCompanyNameChange(value: string) {
    setCompanyName(value);
    if (!companySlug || companySlug === slugify(companyName)) {
      setCompanySlug(slugify(value));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError('Your name is required');
    if (!email.trim()) return setError('Email is required');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (!companyName.trim()) return setError('Company name is required');
    if (companySlug.length < 2 || !/^[a-z0-9-]+$/.test(companySlug)) {
      return setError('Company slug must be lowercase letters, numbers, and dashes');
    }

    setLoading(true);
    try {
      const { data } = await apiClient.post<RegisterResponse>('/auth/register', {
        name,
        email,
        password,
        companyName,
        companySlug,
        timezone: 'UTC',
      });
      setAuthTokens(data.data);
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      const axiosError = err as { response?: { data?: { message?: string | string[] } } };
      const message = axiosError.response?.data?.message;
      setError(Array.isArray(message) ? (message[0] ?? 'Unable to create your account. Please try again.') : message ?? 'Unable to create your account. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full px-4 py-3 bg-slate-800/60 border border-slate-700 rounded-xl text-white placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand transition';

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left brand panel (desktop) */}
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
            Set up your workspace in minutes.
          </h2>
          <p className="text-slate-400 text-base leading-relaxed">
            Create your company, add branches, and start scheduling your team right away. No
            credit card required.
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-950">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center">
              <Building2 size={16} color="white" />
            </div>
            <span className="text-white font-bold font-sans">WorkForce</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1 font-sans">Create your workspace</h1>
          <p className="text-slate-400 text-sm mb-8">Set up your company to get started.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Your name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Work email
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
              <label htmlFor="password" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
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

            <div>
              <label htmlFor="companyName" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Company name
              </label>
              <input
                id="companyName"
                type="text"
                autoComplete="organization"
                required
                value={companyName}
                onChange={(e) => handleCompanyNameChange(e.target.value)}
                placeholder="Acme Corporation"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="companySlug" className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Company slug
              </label>
              <input
                id="companySlug"
                type="text"
                required
                value={companySlug}
                onChange={(e) => setCompanySlug(e.target.value)}
                placeholder="acme-corp"
                className={inputClass}
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Used in your workspace URL. Lowercase letters, numbers, and dashes only.
              </p>
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
              {loading ? 'Creating workspace…' : 'Create workspace'}
            </button>
          </form>

          <p className="text-center text-slate-500 text-xs mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-brand hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
