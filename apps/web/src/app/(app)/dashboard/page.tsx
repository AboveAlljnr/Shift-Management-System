'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import Link from 'next/link';
import type { Route } from 'next';
import { useMemo, useState, useEffect } from 'react';
import {
  MapPin,
  Calendar,
  Clock,
  Plane,
  Users,
  AlertTriangle,
  Zap,
  Shield,
  ChevronRight,
  ArrowRight,
  Send,
  TrendingUp,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import {
  fetchCompany,
  fetchCoverage,
  fetchDailyAttendance,
  fetchEmployeeAttendance,
  fetchEmployees,
  fetchLeaveBalances,
  fetchLeaveRequests,
  fetchMyEmployee,
  fetchMyGeofenceStatus,
  fetchMyShifts,
  fetchShifts,
  recordClockEvent,
  reviewLeaveRequest,
  type ShiftDetail,
} from '@/lib/api/queries';
import { getAuthUser } from '@/lib/auth';
import { cn, formatTime, getInitials } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const weekEndISO = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function statClass(tone: string) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500';
    case 'warning':
      return 'bg-amber-500';
    case 'danger':
      return 'bg-rose-500';
    default:
      return 'bg-slate-300';
  }
}

function StatCard({
  label,
  value,
  tone,
  href,
  icon,
  color = '#3B57E8',
  sub,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  href?: Route;
  icon?: React.ReactNode;
  color?: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  const body = (
    <Card className="p-5 hover:border-slate-300 transition-colors rounded-2xl">
      {icon ? (
        <div className="flex items-start gap-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${color}18` }}
          >
            <span style={{ color }}>{icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
              {label}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 leading-none font-sans">{value}</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              {trend === 'up' && <TrendingUp size={11} className="text-green-500" />}
              {trend === 'down' && <TrendingDownIcon />}
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{sub}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
            <p className="text-3xl font-bold text-slate-900 font-sans">{value}</p>
          </div>
          <span className={cn('inline-block h-2.5 w-2.5 rounded-full mt-1', tone ? statClass(tone) : 'bg-slate-200')} />
        </div>
      )}
    </Card>
  );

  if (href) {
    return <Link href={href}>{body}</Link>;
  }
  return body;
}

function TrendingDownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
      <path d="m22 17-8.5-8.5-5 5L2 7" />
      <path d="M16 17h6v-6" />
    </svg>
  );
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function CoverageRing({ filled, required }: { filled: number; required: number }) {
  const pct = required > 0 ? Math.min(filled / required, 1) : 1;
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  const color = pct >= 0.9 ? '#16A34A' : pct >= 0.7 ? '#D97706' : '#DC2626';

  return (
    <div className="relative w-16 h-16 flex items-center justify-center flex-shrink-0">
      <svg className="absolute inset-0 -rotate-90" width="64" height="64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-700" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="text-center z-10">
        <p className="text-xs font-bold text-white" style={{ color }}>{Math.round(pct * 100)}%</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const user = getAuthUser();
  const isManager = useMemo(() => {
    if (!user) return false;
    const roles = user.roles.map((r) => r.toLowerCase());
    return roles.some((r) =>
      ['owner', 'admin', 'manager', 'shift_manager', 'super_admin'].includes(r),
    );
  }, [user]);

  const { data: company, isLoading: companyLoading } = useQuery({
    queryKey: ['company'],
    queryFn: fetchCompany,
    staleTime: 5 * 60 * 1000,
  });

  if (companyLoading || !company) {
    return (
      <div className="space-y-6">
        <div className="h-28 animate-pulse rounded-xl bg-slate-200/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200/60" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        subtitle={`${isManager ? 'Manager workspace' : 'Team member workspace'} · ${format(today, 'EEEE, MMMM d')}`}
      />

      {isManager ? <ManagerDashboard companyName={company.name} /> : <EmployeeDashboard />}
    </div>
  );
}

// ============================================================
// Employee Dashboard
// ============================================================

function EmployeeDashboard() {
  const queryClient = useQueryClient();
  const [clockNotice, setClockNotice] = useState<string | null>(null);
  const now = useLiveClock();

  const { data: me } = useQuery({
    queryKey: ['myEmployee'],
    queryFn: fetchMyEmployee,
    staleTime: 5 * 60 * 1000,
  });

  const myEmployeeId = me?.id;

  const { data: myShifts, isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts', 'mine', todayISO, weekEndISO],
    queryFn: () => fetchMyShifts(myEmployeeId as string, { startDate: todayISO, endDate: weekEndISO }),
    enabled: !!myEmployeeId,
  });

  const { data: attendance } = useQuery({
    queryKey: ['attendance', 'me', myEmployeeId],
    queryFn: () => fetchEmployeeAttendance(myEmployeeId as string),
    enabled: !!myEmployeeId,
  });

  const { data: balances } = useQuery({
    queryKey: ['leave', 'balances', myEmployeeId],
    queryFn: () => fetchLeaveBalances(myEmployeeId as string),
    enabled: !!myEmployeeId,
  });

  const { data: geofenceStatus } = useQuery({
    queryKey: ['attendance', 'me', 'geofence'],
    queryFn: fetchMyGeofenceStatus,
    staleTime: 60 * 1000,
  });

  const [locating, setLocating] = useState(false);

  const clockMutation = useMutation({
    mutationFn: (args: {
      eventType: 'clock_in' | 'clock_out';
      latitude?: number;
      longitude?: number;
    }) =>
      recordClockEvent({
        eventType: args.eventType,
        clientOccurredAt: new Date().toISOString(),
        idempotencyKey: crypto.randomUUID(),
        latitude: args.latitude,
        longitude: args.longitude,
      }),
    onSuccess: () => {
      setClockNotice('Time recorded');
      queryClient.invalidateQueries({ queryKey: ['attendance', 'me'] });
    },
    onError: (e) => setClockNotice(extractClockError(e)),
    onSettled: () => setLocating(false),
  });

  const handleClock = async () => {
    setClockNotice(null);
    if (isClockedIn) {
      clockMutation.mutate({ eventType: 'clock_out' });
      return;
    }

    if (geofenceStatus?.applicable) {
      setLocating(true);
      try {
        const pos = await getCurrentPosition();
        clockMutation.mutate({
          eventType: 'clock_in',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      } catch (locErr) {
        setLocating(false);
        setClockNotice(getLocationErrorMessage(locErr));
      }
      return;
    }

    clockMutation.mutate({ eventType: 'clock_in' });
  };

  const todaysShift = myShifts?.find((s) => s.startAt.slice(0, 10) === todayISO);
  const upcoming = (myShifts ?? []).filter((s) => s.startAt.slice(0, 10) >= todayISO).slice(0, 3);
  const todaysAttendance = attendance?.find((a) => a.workDate.slice(0, 10) === todayISO);
  const isClockedIn = !!todaysAttendance?.effectiveClockIn && !todaysAttendance?.effectiveClockOut;
  const totalAllocated = (balances ?? []).reduce((sum, b) => sum + b.allocatedDays, 0);
  const totalRemaining = (balances ?? []).reduce((sum, b) => sum + b.remainingDays, 0);

  return (
    <div className="space-y-6">
      {/* Greeting + clock card */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
              {format(today, 'EEEE, MMMM d').toUpperCase()}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-0.5 font-sans">
              Hello{me ? `, ${me.firstName}` : ''} 👋
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {geofenceStatus?.applicable
                ? `Location verified clock-in · ${geofenceStatus.branchName} (within ${Math.round(geofenceStatus.radiusMeters ?? 0)}m)`
                : 'Your workday at a glance'}
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="text-center hidden md:block">
              <p className="text-lg font-bold text-slate-900 tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Local time</p>
            </div>
            <button
              onClick={handleClock}
              disabled={clockMutation.isPending || locating}
              className={cn(
                'px-6 py-3 text-sm font-bold rounded-xl text-white transition-colors shadow-lg focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 active:scale-95',
                isClockedIn
                  ? 'bg-red-600 hover:bg-red-700 shadow-red-200'
                  : 'bg-brand hover:bg-brand-dark shadow-brand/30',
              )}
            >
              {locating
                ? 'Checking your location…'
                : clockMutation.isPending
                  ? 'Recording…'
                  : isClockedIn
                    ? 'CLOCK OUT'
                    : 'CLOCK IN'}
            </button>
            {clockNotice && <p className="text-sm text-slate-500 text-right">{clockNotice}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Today's shift */}
      <div className="bg-sidebar text-white rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">TODAY</span>
          {todaysShift ? (
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full uppercase">
              Active
            </span>
          ) : null}
        </div>
        <p className="text-lg font-bold text-white mb-1 font-sans">
          {todaysShift ? todaysShift.name : 'No shift assigned today'}
        </p>
        {todaysShift ? (
          <>
            <p className="text-slate-300 text-sm font-semibold">
              {formatTime(todaysShift.startAt)} – {formatTime(todaysShift.endAt)}
            </p>
            <div className="flex items-center gap-1.5 mt-2 text-slate-400 text-xs">
              <MapPin size={11} />
              {todaysShift.branch ? todaysShift.branch.name : 'Assigned branch'}
            </div>
            <div className="mt-3">
              <StatusBadge status={todaysShift.status} />
            </div>
          </>
        ) : (
          <p className="text-slate-300 text-sm">
            Enjoy your day off. You can request leave or check upcoming shifts below.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Next shifts (7 days)"
          value={(myShifts ?? []).length}
          href="/schedule"
        />
        <StatCard
          label="Hours worked today"
          value={
            todaysAttendance?.totalWorkedMinutes != null
              ? `${Math.floor(todaysAttendance.totalWorkedMinutes / 60)}h ${todaysAttendance.totalWorkedMinutes % 60}m`
              : '—'
          }
          tone={todaysAttendance ? (isClockedIn ? 'warning' : 'success') : undefined}
        />
        <StatCard
          label="Annual leave used"
          value={totalAllocated > 0 ? `${totalAvailable(totalAllocated, totalRemaining)} used` : '—'}
          href="/leave"
        />
        <StatCard label="Today's status" value={todaysAttendance?.status ?? 'No record'} href="/attendance" />
      </div>

      {/* Upcoming shifts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold text-slate-900 font-sans">Upcoming shifts</CardTitle>
          <CardDescription>Next 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          {shiftsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming shifts.</p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((shift: ShiftDetail) => (
                <li key={shift.id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-2 shift-card">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{shift.name}</p>
                    <p className="text-xs text-slate-400">
                      {format(parseISO(shift.startAt), 'EEE, MMM d')} · {formatTime(shift.startAt)} –{' '}
                      {formatTime(shift.endAt)}
                    </p>
                  </div>
                  <StatusBadge status={shift.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/schedule" className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors">
          <Calendar size={18} className="text-brand mb-2" />
          <p className="text-sm font-bold text-slate-800">My Schedule</p>
          <p className="text-xs text-slate-400">View your shifts</p>
        </Link>
        <Link href="/leave" className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors">
          <Plane size={18} className="text-brand mb-2" />
          <p className="text-sm font-bold text-slate-800">Request Leave</p>
          <p className="text-xs text-slate-400">Plan time off</p>
        </Link>
        <Link href="/attendance" className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors">
          <Clock size={18} className="text-brand mb-2" />
          <p className="text-sm font-bold text-slate-800">Attendance</p>
          <p className="text-xs text-slate-400">Review your time</p>
        </Link>
      </div>
    </div>
  );
}

function totalAvailable(allocated: number, remaining: number): number {
  return Math.max(0, allocated - remaining);
}

// ============================================================
// Manager Dashboard
// ============================================================

const AVATAR_COLORS = [
  '#7C3AED',
  '#2563EB',
  '#DC2626',
  '#0891B2',
  '#059669',
  '#D97706',
  '#64748B',
  '#16A34A',
];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}

interface DashboardAlert {
  id: string;
  level: 'danger' | 'warning';
  text: string;
  href: Route;
  action: string;
}

function ManagerDashboard({ companyName }: { companyName: string }) {
  const queryClient = useQueryClient();
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const now = useLiveClock();

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchEmployees({ limit: 100 }),
    staleTime: 60 * 1000,
  });

  const { data: me } = useQuery({
    queryKey: ['myEmployee'],
    queryFn: fetchMyEmployee,
    staleTime: 5 * 60 * 1000,
  });

  const { data: weekShifts } = useQuery({
    queryKey: ['shifts', todayISO, weekEndISO],
    queryFn: () => fetchShifts({ startDate: todayISO, endDate: weekEndISO }),
    staleTime: 60 * 1000,
  });

  const { data: dailyAttendance } = useQuery({
    queryKey: ['attendance', 'daily', todayISO],
    queryFn: () => fetchDailyAttendance(todayISO),
    staleTime: 60 * 1000,
  });

  const { data: pendingLeave } = useQuery({
    queryKey: ['leave', 'pending'],
    queryFn: () => fetchLeaveRequests({ status: 'pending' }),
    staleTime: 30 * 1000,
  });

  const { data: coverage = [] } = useQuery({
    queryKey: ['coverage', 'week', todayISO, weekEndISO],
    queryFn: () => fetchCoverage((weekShifts ?? []).map((s) => s.id)),
    enabled: !!weekShifts && weekShifts.length > 0,
    staleTime: 60 * 1000,
  });

  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      reviewLeaveRequest(id, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave'] }),
    onError: (e) => setReviewError(e instanceof Error ? e.message : 'Review failed'),
  });

  const activeEmployees = (employees?.data ?? []).filter((e) => e.status === 'active').length;
  const present = (dailyAttendance ?? []).filter((a) =>
    ['present', 'late'].includes(a.status),
  ).length;
  const late = (dailyAttendance ?? []).filter((a) => a.status === 'late').length;
  const absent = (dailyAttendance ?? []).filter((a) =>
    ['absent', 'missing_clock_in', 'missing_clock_out'].includes(a.status),
  ).length;
  const onShiftToday = present + late;

  const shiftById = useMemo(
    () => new Map((weekShifts ?? []).map((s) => [s.id, s] as [string, ShiftDetail])),
    [weekShifts],
  );

  const todayShifts = (weekShifts ?? []).filter((s) => s.startAt.slice(0, 10) === todayISO);
  const todayCoverage = coverage.filter((c) => todayShifts.some((s) => s.id === c.shiftId));
  const filledToday = todayCoverage.reduce((sum, c) => sum + c.headcountFilled, 0);
  const requiredToday = todayCoverage.reduce((sum, c) => sum + c.headcountRequired, 0);

  const uncovered = coverage.filter((c) => c.shortfall > 0);
  const unfilledCount = uncovered.length;

  const shiftLabel = (id: string) => shiftById.get(id)?.name ?? 'Shift';

  const alerts: DashboardAlert[] = [];
  for (const c of uncovered) {
    if (alerts.length >= 6) break;
    const required = c.headcountRequired;
    const filled = c.headcountFilled;
    alerts.push({
      id: `coverage-${c.shiftId}`,
      level: filled === 0 || required - filled >= 2 ? 'danger' : 'warning',
      text: `${shiftLabel(c.shiftId)} is understaffed — ${filled} of ${required} required`,
      href: '/schedule',
      action: 'View Shift',
    });
  }
  if (pendingLeave && pendingLeave.length > 0 && alerts.length < 6) {
    alerts.push({
      id: 'pending-leave',
      level: 'warning',
      text: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? '' : 's'} awaiting your approval`,
      href: '/leave',
      action: 'Review',
    });
  }
  if (late > 0 && alerts.length < 6) {
    alerts.push({
      id: 'late-today',
      level: 'warning',
      text: `${late} employee${late === 1 ? '' : 's'} clocked in late today`,
      href: '/attendance',
      action: 'Attendance',
    });
  }
  const visibleAlerts = alerts.filter((a) => !dismissed.includes(a.id));

  const clockedIn = (dailyAttendance ?? []).filter((a) =>
    ['present', 'late'].includes(a.status),
  );
  const clockedInShown = clockedIn.slice(0, 4);
  const clockedInExtra = Math.max(0, clockedIn.length - clockedInShown.length);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = me?.firstName;
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dangerousCount = visibleAlerts.filter((a) => a.level === 'danger').length;

  return (
    <div className="space-y-6">
      {/* ── Today hero banner ─────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-[#0F172A] border border-[#1E293B] rounded-2xl px-6 py-6">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div>
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-1">
              {format(today, 'EEEE, MMMM d')} · {companyName}
            </p>
            <h1 className="text-xl font-bold text-white font-sans">
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              {dangerousCount > 0
                ? `${dangerousCount} critical alert${dangerousCount === 1 ? '' : 's'} need your attention.`
                : 'All coverage levels look healthy today.'}
            </p>
          </div>

          <div className="text-center hidden md:block">
            <p className="text-3xl font-bold text-white tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
              {timeStr}
            </p>
            <p className="text-xs text-slate-500 mt-1">Local time</p>
          </div>

          <div className="flex items-center gap-5">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Clocked in now</p>
              <div className="flex items-center">
                {clockedInShown.length === 0 ? (
                  <span className="text-xs text-slate-500">No one clocked in yet</span>
                ) : (
                  <>
                    {clockedInShown.map((a, i) => (
                      <div
                        key={a.id}
                        title={`${a.employee.firstName} ${a.employee.lastName}`}
                        className="w-8 h-8 rounded-full border-2 border-[#1E293B] flex items-center justify-center text-white text-[10px] font-bold"
                        style={{
                          background: colorFor(`${a.employee.firstName} ${a.employee.lastName}`),
                          marginLeft: i === 0 ? 0 : -8,
                          zIndex: clockedInShown.length - i,
                        }}
                      >
                        {getInitials(`${a.employee.firstName} ${a.employee.lastName}`)}
                      </div>
                    ))}
                    {clockedInExtra > 0 && (
                      <div
                        className="w-8 h-8 rounded-full border-2 border-[#1E293B] bg-slate-700 flex items-center justify-center text-slate-400 text-[9px] font-bold"
                        style={{ marginLeft: -8 }}
                      >
                        +{clockedInExtra}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {requiredToday > 0 && (
              <div className="flex items-center gap-3 bg-[#1E293B] border border-[#334155] rounded-xl px-4 py-3">
                <CoverageRing filled={filledToday} required={requiredToday} />
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Coverage</p>
                  <p className="text-lg font-bold text-white" style={{ fontFamily: 'var(--font-mono)' }}>
                    {filledToday} / {requiredToday}
                  </p>
                  <p className="text-[10px] text-amber-400">{Math.max(0, requiredToday - filledToday)} not yet in</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI tiles ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Employees"
          value={activeEmployees}
          icon={<Users size={18} />}
          color="#3B57E8"
          sub="active in this workspace"
          trend="up"
          href="/workforce"
        />
        <StatCard
          label="On Shift Today"
          value={onShiftToday}
          icon={<Calendar size={18} />}
          color="#16A34A"
          sub={
            requiredToday > 0
              ? `of ${requiredToday} needed for coverage`
              : 'in attendance today'
          }
          href="/attendance"
        />
        <StatCard
          label="Unfilled Shifts"
          value={unfilledCount}
          icon={<AlertTriangle size={18} />}
          color="#DC2626"
          sub="this week · requires attention"
          trend="down"
          href="/schedule"
        />
        <StatCard
          label="Leave Pending"
          value={pendingLeave?.length ?? 0}
          icon={<Plane size={18} />}
          color="#D97706"
          sub="awaiting your approval"
          href="/leave"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2/3 */}
        <div className="lg:col-span-2 space-y-5">
          {/* Needs Action */}
          {visibleAlerts.length > 0 && (
            <Card className="overflow-hidden rounded-2xl">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-red-50 flex items-center justify-center">
                  <Zap size={13} className="text-red-500" />
                </div>
                <h2 className="text-sm font-bold text-slate-900 font-sans">Needs Action</h2>
                <span className="w-5 h-5 bg-red-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                  {visibleAlerts.length}
                </span>
                <Link
                  href="/schedule"
                  className="ml-auto text-xs text-brand hover:underline flex items-center gap-1"
                >
                  Schedule <ArrowRight size={11} />
                </Link>
              </div>
              <div className="divide-y divide-border">
                {visibleAlerts.map((a) => (
                  <div
                    key={a.id}
                    className={`px-5 py-3.5 flex items-center gap-3 group ${
                      a.level === 'danger' ? 'bg-red-50/50' : 'bg-amber-50/40'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        a.level === 'danger' ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    />
                    <p className="text-sm text-slate-700 flex-1 leading-snug">{a.text}</p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link
                        href={a.href}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                          a.level === 'danger'
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        }`}
                      >
                        {a.action}
                      </Link>
                      <button
                        onClick={() => setDismissed((d) => [...d, a.id])}
                        aria-label="Dismiss alert"
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-500 text-lg leading-none cursor-pointer transition-all"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Today's attendance */}
          <Card className="overflow-hidden rounded-2xl">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-green-50 flex items-center justify-center">
                  <CheckCircleIcon />
                </div>
                <h2 className="text-sm font-bold text-slate-900 font-sans">Today&apos;s Attendance</h2>
              </div>
              <Link href="/attendance" className="text-xs text-brand hover:underline flex items-center gap-1">
                View all <ArrowRight size={11} />
              </Link>
            </div>
            {(dailyAttendance ?? []).length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">
                No attendance records yet today.
              </div>
            ) : (
              <>
                <div className="divide-y divide-border">
                  {(dailyAttendance ?? []).slice(0, 6).map((a) => (
                    <div key={a.id} className="px-5 py-3 flex items-center gap-4 hover:bg-slate-50/60 transition-colors">
                      <AvatarShell
                        initials={getInitials(`${a.employee.firstName} ${a.employee.lastName}`)}
                        color={colorFor(`${a.employee.firstName} ${a.employee.lastName}`)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {a.employee.firstName} {a.employee.lastName}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {a.employee.branch?.name ?? '—'} ·{' '}
                          {formatTime(a.effectiveClockIn ?? a.createdAt)}
                        </p>
                      </div>
                      {a.totalWorkedMinutes > 0 && (
                        <p className="text-xs font-mono text-slate-500 w-16 text-right">
                          {formatMinutes(a.totalWorkedMinutes)}
                        </p>
                      )}
                      <StatusBadge status={a.status} />
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 bg-slate-50/60 border-t border-border">
                  <Link
                    href="/attendance"
                    className="text-xs text-slate-500 hover:text-brand flex items-center gap-1 transition-colors"
                  >
                    View {Math.max(0, (dailyAttendance ?? []).length - 6)} more employees{' '}
                    <ChevronRight size={12} />
                  </Link>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Right 1/3 */}
        <div className="space-y-5">
          {/* Today's shifts */}
          <Card className="overflow-hidden rounded-2xl">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center">
                <Clock size={13} className="text-brand" />
              </div>
              <h2 className="text-sm font-bold text-slate-900 font-sans">Today&apos;s Shifts</h2>
            </div>
            <div className="p-5">
              {todayShifts.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No shifts scheduled today.{' '}
                  <Link href="/schedule" className="text-brand hover:underline">
                    Add a shift
                  </Link>
                  .
                </p>
              ) : (
                <div className="relative">
                  <div className="absolute left-[56px] top-3 bottom-3 w-px bg-slate-100" />
                  <div className="space-y-4">
                    {[...todayShifts]
                      .sort((a, b) => a.startAt.localeCompare(b.startAt))
                      .slice(0, 6)
                      .map((s) => {
                        const assignee = s.assignments[0]?.employee;
                        return (
                          <div key={s.id} className="flex items-center gap-0">
                            <p className="w-14 text-right text-xs font-semibold text-slate-400 pr-3 flex-shrink-0 tabular-nums">
                              {formatTime(s.startAt)}
                            </p>
                            <div className="relative z-10 flex-shrink-0 mx-2">
                              <div
                                className={`w-2.5 h-2.5 rounded-full border-2 border-white ${
                                  s.status === 'published'
                                    ? 'bg-green-500'
                                    : s.status === 'draft'
                                      ? 'bg-slate-300'
                                      : s.status === 'cancelled'
                                        ? 'bg-slate-400'
                                        : 'bg-amber-400'
                                }`}
                              />
                            </div>
                            <div className="flex-1 flex items-center gap-2 pl-1">
                              {assignee ? (
                                <AvatarShell
                                  initials={getInitials(`${assignee.firstName} ${assignee.lastName}`)}
                                  color={colorFor(`${assignee.firstName} ${assignee.lastName}`)}
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[9px] font-bold text-slate-400 flex-shrink-0">
                                  —
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-800 truncate">
                                  {assignee
                                    ? `${assignee.firstName} ${assignee.lastName}`
                                    : 'Unassigned'}
                                </p>
                                <p className="text-[10px] text-slate-400 truncate">{s.name}</p>
                              </div>
                              <span className="ml-auto">
                                <StatusBadge status={s.status} />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 pb-4">
              <Link
                href="/schedule"
                className="w-full py-2 text-xs font-semibold text-brand hover:bg-brand-light rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <PlusIcon /> Add shift <ArrowRight size={11} />
              </Link>
            </div>
          </Card>

          {/* Leave approvals */}
          <Card className="overflow-hidden rounded-2xl">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Plane size={13} className="text-amber-600" />
                </div>
                <h2 className="text-sm font-bold text-slate-900 font-sans">Leave Requests</h2>
              </div>
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                {pendingLeave?.length ?? 0} pending
              </span>
            </div>
            {reviewError && (
              <p className="px-5 pt-3 text-xs text-red-600">{reviewError}</p>
            )}
            {(pendingLeave ?? []).length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No pending requests.</div>
            ) : (
              <>
                <div className="divide-y divide-border">
                  {(pendingLeave ?? []).slice(0, 4).map((r) => (
                    <div key={r.id} className="px-4 py-3.5">
                      <div className="flex items-center gap-3 mb-2.5">
                        <AvatarShell
                          initials={getInitials(`${r.employee.firstName} ${r.employee.lastName}`)}
                          color={colorFor(`${r.employee.firstName} ${r.employee.lastName}`)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">
                            {r.employee.firstName} {r.employee.lastName}
                          </p>
                          <p className="text-xs text-slate-400">
                            {r.leaveType.name} · {format(parseISO(r.startDate as string), 'MMM d')} –{' '}
                            {format(parseISO(r.endDate as string), 'MMM d')} ({r.requestedDays}d)
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => review.mutate({ id: r.id, action: 'approve' })}
                          disabled={review.isPending}
                          className="py-1.5 text-xs font-semibold bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 cursor-pointer transition-colors disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => review.mutate({ id: r.id, action: 'reject' })}
                          disabled={review.isPending}
                          className="py-1.5 text-xs font-semibold bg-slate-50 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 bg-slate-50/60 border-t border-border">
                  <Link
                    href="/leave"
                    className="text-xs text-brand hover:underline flex items-center gap-1"
                  >
                    View all leave requests <ChevronRight size={12} />
                  </Link>
                </div>
              </>
            )}
          </Card>

          {/* Quick actions */}
          <Card className="rounded-2xl p-5">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Quick Actions</h2>
            <div className="space-y-1.5">
              {[
                { label: 'Add a shift', icon: <Calendar size={14} />, href: '/schedule' as Route, color: '#3B57E8' },
                { label: 'Generate schedule', icon: <Zap size={14} />, href: '/schedule' as Route, color: '#7C3AED' },
                { label: 'View organization', icon: <Users size={14} />, href: '/organization' as Route, color: '#0891B2' },
                { label: 'Audit log', icon: <Shield size={14} />, href: '/activities' as Route, color: '#64748B' },
              ].map((q) => (
                <Link
                  key={q.label}
                  href={q.href}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 group transition-colors cursor-pointer text-left"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${q.color}18`, color: q.color }}
                  >
                    {q.icon}
                  </div>
                  <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors flex-1">
                    {q.label}
                  </span>
                  <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AvatarShell({ initials, color }: { initials: string; color: string }) {
  return (
    <Avatar initials={initials} color={color} size="sm" className="w-8 h-8 text-[10px]" />
  );
}

function CheckCircleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

function getLocationErrorMessage(error: unknown): string {
  if (error instanceof GeolocationPositionError) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return 'Location access was denied. Allow location to clock in at this branch.';
      case error.POSITION_UNAVAILABLE:
        return 'Your location could not be determined right now.';
      case error.TIMEOUT:
        return 'Location request timed out. Try again.';
      default:
        return 'Unable to determine your location.';
    }
  }
  return error instanceof Error ? error.message : 'Unable to determine your location.';
}

interface ClockErrorBody {
  message?: string;
  errors?: Array<{ code?: string; message?: string }>;
}

function extractClockError(error: unknown): string {
  const ax = error as AxiosError<ClockErrorBody>;
  const data = ax?.response?.data;
  const first = data?.errors?.[0];
  if (first?.code === 'GEOFENCE_OUTSIDE') {
    return first.message ?? data?.message ?? 'You are outside the allowed clock-in area.';
  }
  if (axios.isAxiosError(error) && data?.message) return data.message;
  return 'Unable to record time. Try again.';
}