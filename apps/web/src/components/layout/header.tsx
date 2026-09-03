'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { clearAuth, getAuthUser } from '@/lib/auth';
import { getInitials } from '@/lib/utils';

export function Header() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = getAuthUser();

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
    <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-background shrink-0">
      <div className="flex items-center gap-2" />

      <div className="flex items-center gap-3">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-full p-1 hover:bg-muted transition-colors"
            aria-label="Account menu"
          >
            <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
              {getInitials(displayName)}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 z-50 w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
              <div className="border-b border-border px-4 py-3">
                <p className="truncate text-sm font-medium">{displayName}</p>
                {user?.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
                {user && user.roles.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {user.roles.join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="w-full px-4 py-2.5 text-left text-sm text-destructive transition-colors hover:bg-muted"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}