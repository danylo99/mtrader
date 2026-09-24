'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Activity, LayoutDashboard, LogOut, Settings, PlusCircle, ShoppingCart, Menu, X, ChevronDown, Search, Bell } from 'lucide-react';
import engineFetch from '@/lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (accountOpen && accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setAccountOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [accountOpen]);

  useEffect(() => {
    (async () => {
      try {
        const data = await engineFetch('/api/auth/me');
        if (!data.success) {
          router.push('/');
        } else {
          setUser(data.data);
        }
      } catch {
        router.push('/');
      }
    })();
  }, [router]);

  async function handleLogout() {
    try {
      await engineFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    if (typeof window !== 'undefined') sessionStorage.removeItem('token');
    router.push('/');
  }

  if (!user) return null;

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/dashboard/screener-supertrend', label: 'RollingSuperTrend2', icon: Search },
    { href: '/dashboard/screener-ew', label: 'EW Signal', icon: Search },
    { href: '/dashboard/screener-mazscore', label: 'MA Z-Score', icon: Search },
    { href: '/dashboard/alarms', label: 'Price Alarms', icon: Bell },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    { href: '/dashboard/orders/new', label: 'Place Order', icon: ShoppingCart },
    { href: '/dashboard/setups/new', label: 'New Trade', icon: PlusCircle },
  ];

  return (
    <div className="flex h-screen flex-col bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-700/50 bg-slate-800/80 px-4 sm:px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex sm:hidden items-center justify-center rounded-lg p-1.5 text-slate-400 hover:text-white"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-blue-600">
            <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
          </div>
          <Link href="/dashboard" className="text-base sm:text-lg font-bold text-white">OmniTrader</Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div
            className="relative"
            ref={accountRef}
            onMouseEnter={() => {
              if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
              }
              setAccountOpen(true);
            }}
            onMouseLeave={() => {
              if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
              closeTimerRef.current = window.setTimeout(() => setAccountOpen(false), 150);
            }}
          >
            <button
              onClick={() => setAccountOpen(!accountOpen)}
              className="flex items-center gap-2 rounded-lg px-2 sm:px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-700/20 cursor-pointer"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
            >
              <span className="text-sm text-slate-500 truncate max-w-[12rem] text-left">{user.email}</span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>

            {accountOpen && (
              <div className="absolute right-0 mt-2 w-44 rounded bg-slate-800 border border-slate-700/50 shadow-lg py-1 z-50"
                onMouseEnter={() => {
                  if (closeTimerRef.current) {
                    clearTimeout(closeTimerRef.current);
                    closeTimerRef.current = null;
                  }
                }}
                onMouseLeave={() => {
                  if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
                  closeTimerRef.current = window.setTimeout(() => setAccountOpen(false), 150);
                }}
              >
                <Link href="/dashboard/settings" onClick={() => setAccountOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm ${
                    pathname === '/dashboard/settings' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                  }`}>
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
                <button onClick={() => { setAccountOpen(false); handleLogout(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white">
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="sm:hidden border-b border-slate-700/50 bg-slate-800/60 px-4 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <nav className="hidden sm:flex w-56 flex-col border-r border-slate-700/50 bg-slate-800/40 p-4">
          <Link href="/dashboard"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname === '/dashboard' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Link>
          <Link href="/dashboard/screener-supertrend"
            className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.startsWith('/dashboard/screener-supertrend') ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <Search className="h-4 w-4" />
            SuperTrend
          </Link>
          <Link href="/dashboard/screener-ew"
            className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.startsWith('/dashboard/screener-ew') ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <Search className="h-4 w-4" />
            EW Signal
          </Link>
          <Link href="/dashboard/screener-mazscore"
            className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.startsWith('/dashboard/screener-mazscore') ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <Search className="h-4 w-4" />
            MA Z-Score
          </Link>
          <Link href="/dashboard/alarms"
            className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.startsWith('/dashboard/alarms') ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <Bell className="h-4 w-4" />
            Price Alarms
          </Link>
          <Link href="/dashboard/orders/new"
            className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.includes('/orders/new') ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <ShoppingCart className="h-4 w-4" />
            Place Order
          </Link>
          <Link href="/dashboard/setups/new"
            className={`mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.includes('/setups/new') ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <PlusCircle className="h-4 w-4" />
            New Trade
          </Link>
          <Link href="/dashboard/settings"
            className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname === '/dashboard/settings' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <button onClick={handleLogout}
            className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-white">
            <LogOut className="h-4 w-4" />
            Logout
          </button>
          <div className="mt-auto pt-4 border-t border-slate-700/50">
            <p className="text-xs text-slate-600">OmniTrader v1.0</p>
          </div>
        </nav>

        <main className="flex-1 overflow-auto p-4 sm:p-6 pb-24 sm:pb-6">
          {children}
        </main>
      </div>

      <nav className="sm:hidden fixed bottom-0 left-0 right-0 flex items-center justify-around border-t border-slate-700/50 bg-slate-800/95 backdrop-blur-xl px-2 py-2 pb-safe z-50">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                isActive ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}