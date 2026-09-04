'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Calendar,
  ClipboardCheck,
  UmbrellaOff,
  Users,
  Building2,
  Shield,
  Settings,
  CreditCard,
  Smartphone,
  ChevronLeft,
  ChevronRight,
  Activity,
  FileText,
  Bell,
  User,
  BarChart3,
  CalendarClock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getAuthUser } from '@/lib/auth';

type NavItem = { href: Route; label: string; icon: LucideIcon };
type NavSection = { heading: string | null; items: NavItem[] };

const EMPLOYEE_SECTIONS: NavSection[] = [
  {
    heading: null,
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'SCHEDULING',
    items: [
      { href: '/schedule', label: 'My Schedule', icon: Calendar },
      { href: '/availability', label: 'Availability', icon: CalendarClock },
    ],
  },
  {
    heading: 'TIME',
    items: [
      { href: '/attendance', label: 'Attendance', icon: ClipboardCheck },
      { href: '/leave', label: 'Leave', icon: UmbrellaOff },
    ],
  },
  {
    heading: null,
    items: [
      { href: '/activities', label: 'Activities', icon: Activity },
      { href: '/documents', label: 'Documents', icon: FileText },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/profile', label: 'Profile', icon: User },
    ],
  },
];

const MANAGER_SECTIONS: NavSection[] = [
  {
    heading: null,
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'WORKFORCE',
    items: [
      { href: '/workforce', label: 'Workforce', icon: Users },
      { href: '/organization', label: 'Organization', icon: Building2 },
    ],
  },
  {
    heading: 'SCHEDULING',
    items: [
      { href: '/schedule', label: 'Schedule', icon: Calendar },
      { href: '/availability', label: 'Availability', icon: CalendarClock },
    ],
  },
  {
    heading: 'TIME',
    items: [
      { href: '/attendance', label: 'Attendance', icon: ClipboardCheck },
      { href: '/leave', label: 'Leave', icon: UmbrellaOff },
    ],
  },
  {
    heading: 'MANAGEMENT',
    items: [
      { href: '/reports', label: 'Reports', icon: BarChart3 },
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/billing', label: 'Billing', icon: CreditCard },
    ],
  },
];

function isManager() {
  const user = getAuthUser();
  if (!user) return false;
  return user.roles.some((r) => r !== 'EMPLOYEE');
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const manager = isManager();
  const sections = manager ? MANAGER_SECTIONS : EMPLOYEE_SECTIONS;

  return (
    <aside
      className={cn(
        'flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200 flex-shrink-0',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center border-b border-sidebar-border h-14 flex-shrink-0',
          collapsed ? 'justify-center px-0' : 'px-5 gap-3',
        )}
      >
        <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
          <Building2 size={14} color="white" />
        </div>
        {!collapsed && (
          <span className="text-white font-bold text-sm font-sans">WorkForce</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'pt-3' : ''}>
            {section.heading && !collapsed && (
              <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-3 pb-2">
                {section.heading}
              </p>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg transition-colors cursor-pointer',
                    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
                    isActive
                      ? 'bg-brand text-white'
                      : 'text-slate-400 hover:bg-sidebar-accent hover:text-slate-200',
                  )}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        {/* Mobile view */}
        <div className="pt-3">
          {!collapsed && (
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest px-3 pb-2">
              EMPLOYEE APP
            </p>
          )}
          <Link
            href="/mobile"
            title={collapsed ? 'Mobile Employee' : undefined}
            className={cn(
              'w-full flex items-center gap-3 rounded-lg transition-colors cursor-pointer',
              collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
              pathname === '/mobile'
                ? 'bg-brand text-white'
                : 'text-slate-400 hover:bg-sidebar-accent hover:text-slate-200',
            )}
          >
            <Smartphone size={16} className="flex-shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Mobile Employee</span>}
          </Link>
        </div>
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 hover:bg-sidebar-accent hover:text-slate-300 transition-colors cursor-pointer"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight size={16} className="mx-auto" />
          ) : (
            <>
              <ChevronLeft size={16} />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
