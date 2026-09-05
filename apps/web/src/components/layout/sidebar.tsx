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
  Sparkles,
  Radio,
  Clock,
  Briefcase,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn, getInitials } from '@/lib/utils';
import { getAuthUser, getPersonaInfo, getPrimaryRole, type PersonaRole } from '@/lib/auth';

type NavItem = { href: Route; label: string; icon: LucideIcon; badge?: string };
type NavSection = { heading: string | null; items: NavItem[] };

// ============================================================
// 1. OWNER / EXECUTIVE NAVIGATION
// ============================================================
const OWNER_SECTIONS: NavSection[] = [
  {
    heading: 'EXECUTIVE',
    items: [
      { href: '/dashboard', label: 'Executive Hub', icon: LayoutDashboard },
    ],
  },
  {
    heading: 'ORGANIZATION & STAFF',
    items: [
      { href: '/workforce', label: 'Workforce Directory', icon: Users },
      { href: '/organization', label: 'Branches & Depts', icon: Building2 },
    ],
  },
  {
    heading: 'OPERATIONS OVERSIGHT',
    items: [
      { href: '/schedule', label: 'Master Schedule', icon: Calendar },
      { href: '/attendance', label: 'Attendance & Radar', icon: ClipboardCheck },
      { href: '/reports', label: 'Executive Analytics', icon: BarChart3 },
    ],
  },
  {
    heading: 'SYSTEM & GOVERNANCE',
    items: [
      { href: '/settings', label: 'Company Settings', icon: Settings },
      { href: '/billing', label: 'Billing & Plan', icon: CreditCard },
      { href: '/activities', label: 'Audit Trail', icon: Activity },
    ],
  },
];

// ============================================================
// 2. OPERATIONS MANAGER NAVIGATION
// ============================================================
const MANAGER_SECTIONS: NavSection[] = [
  {
    heading: 'OPERATIONS',
    items: [
      { href: '/dashboard', label: 'Manager Hub', icon: LayoutDashboard },
    ],
  },
  {
    heading: 'SCHEDULING & ROSTER',
    items: [
      { href: '/schedule', label: 'Schedule Matrix', icon: Calendar, badge: 'AI' },
      { href: '/availability', label: 'Staff Availability', icon: CalendarClock },
    ],
  },
  {
    heading: 'WORKFORCE & TEAM',
    items: [
      { href: '/workforce', label: 'Team Members', icon: Users },
    ],
  },
  {
    heading: 'TIME & APPROVALS',
    items: [
      { href: '/attendance', label: 'Daily Timesheets', icon: ClipboardCheck },
      { href: '/leave', label: 'Leave Approvals', icon: UmbrellaOff },
      { href: '/reports', label: 'Shift Reports', icon: BarChart3 },
    ],
  },
];

// ============================================================
// 3. SHIFT SUPERVISOR NAVIGATION
// ============================================================
const SUPERVISOR_SECTIONS: NavSection[] = [
  {
    heading: 'COMMAND CENTER',
    items: [
      { href: '/dashboard', label: 'Live Shift Radar', icon: Radio },
    ],
  },
  {
    heading: 'FLOOR OPERATIONS',
    items: [
      { href: '/attendance', label: 'Presence & Geofence', icon: Shield },
      { href: '/schedule', label: 'Shift Roster', icon: Calendar },
    ],
  },
  {
    heading: 'TEAM COORDINATION',
    items: [
      { href: '/availability', label: 'Availability Radar', icon: CalendarClock },
      { href: '/leave', label: 'Floor Swaps & Time', icon: UmbrellaOff },
      { href: '/activities', label: 'Shift Activity Log', icon: Activity },
    ],
  },
];

// ============================================================
// 4. EMPLOYEE / TEAM MEMBER NAVIGATION
// ============================================================
const EMPLOYEE_SECTIONS: NavSection[] = [
  {
    heading: 'MY WORKSPACE',
    items: [
      { href: '/dashboard', label: 'My Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    heading: 'MY SHIFTS',
    items: [
      { href: '/schedule', label: 'My Schedule', icon: Calendar },
      { href: '/availability', label: 'My Availability', icon: CalendarClock },
    ],
  },
  {
    heading: 'TIME & REQUESTS',
    items: [
      { href: '/attendance', label: 'My Timesheet', icon: Clock },
      { href: '/leave', label: 'Request Leave', icon: UmbrellaOff },
    ],
  },
  {
    heading: 'SELF-SERVICE',
    items: [
      { href: '/documents', label: 'My Documents', icon: FileText },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/profile', label: 'My Profile', icon: User },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const user = getAuthUser();
  const persona = getPersonaInfo(user);

  let sections = EMPLOYEE_SECTIONS;
  if (persona.role === 'OWNER') sections = OWNER_SECTIONS;
  else if (persona.role === 'MANAGER') sections = MANAGER_SECTIONS;
  else if (persona.role === 'SUPERVISOR') sections = SUPERVISOR_SECTIONS;

  const displayName =
    user?.email
      ?.split('@')[0]
      ?.replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? 'Demo User';

  return (
    <aside
      className={cn(
        'flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200 flex-shrink-0 select-none',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Brand Header */}
      <div
        className={cn(
          'flex items-center border-b border-sidebar-border h-14 flex-shrink-0',
          collapsed ? 'justify-center px-0' : 'px-5 gap-3',
        )}
      >
        <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center flex-shrink-0 shadow-sm shadow-brand/40">
          <Building2 size={16} color="white" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <span className="text-white font-bold text-sm font-sans tracking-tight block">WorkForce</span>
            <span className="text-[10px] text-slate-400 font-medium truncate block">Shift Management</span>
          </div>
        )}
      </div>

      {/* Role Persona Banner */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1">
          <div
            className={cn(
              'px-3 py-2 rounded-xl border flex items-center justify-between gap-2 transition-all',
              persona.badgeBg,
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: persona.accentHex }} />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider truncate font-sans text-white">
                  {persona.title}
                </p>
                <p className="text-[9px] text-slate-400 truncate">
                  {persona.tagline}
                </p>
              </div>
            </div>
            <span
              className="text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase flex-shrink-0 border"
              style={{
                borderColor: `${persona.accentHex}40`,
                backgroundColor: `${persona.accentHex}25`,
                color: persona.accentHex === '#7C3AED' ? '#C084FC' : persona.accentHex === '#2563EB' ? '#93C5FD' : persona.accentHex === '#059669' ? '#6EE7B7' : '#7DD3FC',
              }}
            >
              {persona.role}
            </span>
          </div>
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'pt-3' : 'pt-1'}>
            {section.heading && !collapsed && (
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-3 pb-1.5 font-mono">
                {section.heading}
              </p>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center justify-between rounded-xl transition-all cursor-pointer group',
                    collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
                    isActive
                      ? 'bg-brand text-white font-semibold shadow-sm shadow-brand/20'
                      : 'text-slate-400 hover:bg-sidebar-accent hover:text-slate-100',
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon size={16} className={cn('flex-shrink-0 transition-transform group-hover:scale-110', isActive ? 'text-white' : 'text-slate-400')} />
                    {!collapsed && <span className="text-xs truncate">{item.label}</span>}
                  </div>
                  {!collapsed && item.badge && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        {/* Mobile Employee Quick Link (For floor workers & mobile punch) */}
        <div className="pt-3">
          {!collapsed && (
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-3 pb-1.5 font-mono">
              EMPLOYEE APP
            </p>
          )}
          <Link
            href="/mobile"
            title={collapsed ? 'Mobile Punch Clock' : undefined}
            className={cn(
              'w-full flex items-center gap-3 rounded-xl transition-all cursor-pointer',
              collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
              pathname === '/mobile'
                ? 'bg-brand text-white font-semibold'
                : 'text-slate-400 hover:bg-sidebar-accent hover:text-slate-100',
            )}
          >
            <Smartphone size={16} className="flex-shrink-0" />
            {!collapsed && <span className="text-xs font-medium">Mobile Punch Clock</span>}
          </Link>
        </div>
      </nav>

      {/* User Identity & Persona Info */}
      {!collapsed && (
        <div className="p-2 border-t border-sidebar-border bg-slate-900/40">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow"
              style={{ backgroundColor: persona.accentHex }}
            >
              {getInitials(displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200 truncate leading-tight">{displayName}</p>
              <p className="text-[10px] text-slate-400 truncate leading-tight font-mono">{user?.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-slate-400 hover:bg-sidebar-accent hover:text-slate-200 transition-colors cursor-pointer"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight size={16} className="mx-auto" />
          ) : (
            <>
              <ChevronLeft size={16} />
              <span className="text-xs font-medium">Collapse Menu</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

