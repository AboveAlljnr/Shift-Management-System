'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Bell, LogOut, ChevronDown, ShieldCheck, UserCheck, Sparkles, Building2, Radio } from 'lucide-react';

import { clearAuth, getAuthUser, getPersonaInfo, roleLabel } from '@/lib/auth';
import { fetchUnreadCount } from '@/lib/api/queries';
import { cn, getInitials } from '@/lib/utils';

export function Header() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = getAuthUser();
  const persona = getPersonaInfo(user);

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: fetchUnreadCount,
    refetchInterval: 30 * 1000,
  });
  const unreadCount = unread?.count ?? 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleLogout() {
    clearAuth();
    router.replace('/login');
    router.refresh();
  }

  const displayName =
    user?.email
      ?.split('@')[0]
      ?.replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Demo User';

  return (
    <header className="h-14 flex-shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-20">
      {/* Left Workspace Indicator */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider hidden sm:inline">
            WorkForce
          </span>
          <span className="text-slate-300 hidden sm:inline">/</span>
          <span
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 shadow-sm',
              persona.badgeBg,
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: persona.accentHex }} />
            {persona.title}
          </span>
        </div>
      </div>

      {/* Right User Actions */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <Link
          href="/notifications"
          className="relative w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer transition-colors border border-transparent hover:border-slate-200"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        {/* User Profile Pill Menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-xl p-1 pr-3 hover:bg-slate-100 transition-all border border-slate-200/80 cursor-pointer bg-slate-50/50"
            aria-label="Account menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <span
              className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm"
              style={{ backgroundColor: persona.accentHex }}
            >
              {getInitials(displayName)}
            </span>
            <div className="text-left hidden md:block">
              <p className="text-xs font-bold text-slate-800 leading-tight truncate max-w-[120px]">{displayName}</p>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider leading-none">
                {persona.role}
              </p>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 z-50 w-72 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
              {/* Account Header */}
              <div className="p-4 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shadow"
                    style={{ backgroundColor: persona.accentHex }}
                  >
                    {getInitials(displayName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{displayName}</p>
                    {user?.email && <p className="truncate text-xs text-slate-500 font-mono">{user.email}</p>}
                  </div>
                </div>

                {/* Persona Capability Tag */}
                <div className={cn('mt-2 p-2 rounded-xl border text-xs', persona.badgeBg)}>
                  <p className="font-bold flex items-center gap-1.5 mb-0.5">
                    <ShieldCheck size={14} />
                    {persona.title}
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-tight">
                    {persona.description}
                  </p>
                </div>
              </div>

              {/* Menu Links */}
              <div className="p-2 space-y-1">
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <UserCheck size={15} className="text-slate-400" />
                  My Profile & Settings
                </Link>
                {persona.role === 'OWNER' && (
                  <Link
                    href="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <Building2 size={15} className="text-slate-400" />
                    Company Administration
                  </Link>
                )}
                {persona.role === 'SUPERVISOR' && (
                  <Link
                    href="/attendance"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <Radio size={15} className="text-emerald-500" />
                    Live Floor Presence Radar
                  </Link>
                )}
              </div>

              {/* Sign Out */}
              <div className="p-2 border-t border-slate-100 bg-slate-50/50">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <LogOut size={15} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

