'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Bell, LogOut, ChevronDown } from 'lucide-react';

import { clearAuth, getAuthUser, roleLabel } from '@/lib/auth';
import { fetchUnreadCount } from '@/lib/api/queries';
import { getInitials } from '@/lib/utils';

export function Header() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = getAuthUser();

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
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Account';

  return (
    <header className="h-14 flex-shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-2">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
          WorkForce
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/notifications"
          className="relative w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer transition-colors"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Account menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <span className="h-8 w-8 rounded-full bg-brand flex items-center justify-center text-sm font-semibold text-white">
              {getInitials(displayName)}
            </span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 z-50 w-60 rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
                {user?.email && <p className="truncate text-xs text-slate-500">{user.email}</p>}
                {user && user.roles.length > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    {user.roles.map(roleLabel).join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-slate-50 cursor-pointer"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
