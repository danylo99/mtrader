'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, Eye, EyeOff, ShieldCheck, Sparkles, TrendingUp, Repeat, Shield } from 'lucide-react';
import engineFetch from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await engineFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (!data.success) {
        setError(data.error || 'Login failed');
      } else {
        if (typeof window !== 'undefined') sessionStorage.setItem('token', data.data.token);
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-8 px-4 py-10 md:[grid-template-columns:60%_40%] lg:px-10">
        <section className="relative overflow-hidden rounded-[2rem] border border-slate-800/80 bg-slate-900/80 p-8 shadow-[0_35px_60px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.14),_transparent_24%)]" />
          <div className="relative z-10 flex h-full flex-col justify-between gap-10">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3 rounded-3xl border border-slate-700/70 bg-slate-950/80 px-4 py-3 text-slate-300 shadow-lg shadow-slate-950/20 backdrop-blur-md">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 shadow-lg shadow-cyan-500/20">
                  <Activity className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">Introducing</p>
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Omnitrader</h1>
                </div>
              </div>

              <div className="space-y-5">
                <p className="max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                  Automated trading based on your custom setup. Hand over after configuration; our system handles the rest.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-3xl border border-slate-700/60 bg-slate-950/70 p-5 shadow-[0_15px_35px_rgba(15,23,42,0.25)]">
                    <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-cyan-300">
                      <TrendingUp className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-sm font-semibold text-white">Trend Detection</h3>
                    <p className="text-sm leading-6 text-slate-400">Identifies market direction so your strategies stay aligned with momentum.</p>
                  </div>
                  <div className="rounded-3xl border border-slate-700/60 bg-slate-950/70 p-5 shadow-[0_15px_35px_rgba(15,23,42,0.25)]">
                    <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-emerald-300">
                      <Repeat className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-sm font-semibold text-white">Correlation Timing</h3>
                    <p className="text-sm leading-6 text-slate-400">Optimizes trade entry based on asset correlation and price movement alignment.</p>
                  </div>
                  <div className="rounded-3xl border border-slate-700/60 bg-slate-950/70 p-5 shadow-[0_15px_35px_rgba(15,23,42,0.25)]">
                    <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-sky-300">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-sm font-semibold text-white">Active Management</h3>
                    <p className="text-sm leading-6 text-slate-400">Indicators detect reversals, manage positions, execute multiple TPs, and secure BEs.</p>
                  </div>
                  <div className="rounded-3xl border border-slate-700/60 bg-slate-950/70 p-5 shadow-[0_15px_35px_rgba(15,23,42,0.25)]">
                    <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-indigo-300">
                      <Shield className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-sm font-semibold text-white">Automatic Exit</h3>
                    <p className="text-sm leading-6 text-slate-400">Positions are safely closed when the trend ends, protecting your capital.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-700/60 bg-slate-950/80 p-5 text-slate-400 shadow-[0_15px_35px_rgba(15,23,42,0.12)]">
              <div className="flex items-center gap-3 text-sm">
                <Sparkles className="h-5 w-5 text-cyan-300" />
                <span>Pro-grade execution built for traders who want automation without compromise.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center rounded-[2rem] border border-slate-800/80 bg-slate-950/95 p-8 shadow-[0_35px_70px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:p-10">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.32em] text-cyan-300">Secure access</p>
              <h2 className="text-3xl font-semibold tracking-tight text-white">Sign in to your account</h2>
              <p className="text-sm leading-6 text-slate-400">Enter your credentials to access Omnitrader and manage your trading setups.</p>
            </div>

            <div className="rounded-[2rem] border border-slate-800/70 bg-slate-900/90 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.35)]">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-slate-200">Email or Username</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-200">
                    <label htmlFor="password">Password</label>
                    <Link href="/forgot-password" className="text-cyan-300 hover:text-cyan-200">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 pr-12 text-slate-100 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-3 inline-flex items-center rounded-full p-2 text-slate-400 transition hover:text-cyan-300"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm text-slate-300">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
                    />
                    Remember me
                  </label>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-sky-500 px-5 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
              </form>
            </div>

            <p className="text-center text-sm text-slate-400">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="font-medium text-cyan-300 hover:text-cyan-200">
                Sign up
              </Link>
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-slate-800/70 bg-slate-950/90 py-4 px-4 text-center text-sm text-slate-500 sm:px-10">
        © {new Date().getFullYear()} Omnitrader. All rights reserved.
      </footer>
    </main>
  );
}
