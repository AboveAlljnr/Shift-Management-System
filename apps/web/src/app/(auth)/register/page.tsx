'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

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

  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Shift<span className="text-primary">MS</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Set up your company workspace</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            Your name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Jane Doe"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Work email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="you@company.com"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="At least 8 characters"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="companyName" className="text-sm font-medium">
            Company name
          </label>
          <input
            id="companyName"
            type="text"
            autoComplete="organization"
            required
            value={companyName}
            onChange={(e) => handleCompanyNameChange(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Acme Corporation"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="companySlug" className="text-sm font-medium">
            Company slug
          </label>
          <input
            id="companySlug"
            type="text"
            required
            value={companySlug}
            onChange={(e) => setCompanySlug(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="acme-corp"
          />
          <p className="text-xs text-muted-foreground">
            Used in your workspace URL. Lowercase letters, numbers, and dashes only.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Creating workspace…' : 'Create workspace'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}