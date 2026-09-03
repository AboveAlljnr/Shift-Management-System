'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { Route } from 'next';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  fetchCompany,
  fetchDailyAttendance,
  fetchEmployeeAttendance,
  fetchEmployees,
  fetchLeaveBalances,
  fetchLeaveRequests,
  fetchMyEmployee,
  fetchMyShifts,
  fetchShifts,
  recordClockEvent,
  reviewLeaveRequest,
  type ShiftDetail,
} from '@/lib/api/queries';
import { getAuthUser } from '@/lib/auth';
import { cn, formatTime } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const weekEndISO = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function statClass(tone: string) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-100 text-emerald-800';
    case 'warning':
      return 'bg-amber-100 text-amber-800';
    case 'danger':
      return 'bg-rose-100 text-rose-800';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function StatCard({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  href?: Route;
}) {
  const body = (
    <Card className="hover:border-ring/40 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <span className={cn('inline-flex h-2 w-2 rounded-full', tone ? statClass(tone) : 'bg-muted')} />
        </div>
        <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href}>{body}</Link>;
  }
  return body;
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
        <div className="h-28 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
        <p className="text-sm text-muted-foreground">
          {isManager ? 'Manager workspace' : 'Team member workspace'} · {format(today, 'EEEE, MMMM d')}
        </p>
      </div>

      {isManager ? <ManagerDashboard /> : <EmployeeDashboard />}
    </div>
  );
}

// ============================================================
// Employee Dashboard
// ============================================================

function EmployeeDashboard() {
  const queryClient = useQueryClient();
  const [clockNotice, setClockNotice] = useState<string | null>(null);

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

  const clockMutation = useMutation({
    mutationFn: (eventType: 'clock_in' | 'clock_out') =>
      recordClockEvent({ eventType, clientOccurredAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => {
      setClockNotice('Time recorded');
      queryClient.invalidateQueries({ queryKey: ['attendance', 'me'] });
    },
    onError: () => setClockNotice('Unable to record time. Try again.'),
  });

  const todaysShift = myShifts?.find((s) => s.startAt.slice(0, 10) === todayISO);
  const upcoming = (myShifts ?? []).filter((s) => s.startAt.slice(0, 10) >= todayISO).slice(0, 3);
  const todaysAttendance = attendance?.find((a) => a.workDate.slice(0, 10) === todayISO);
  const isClockedIn = !!todaysAttendance?.effectiveClockIn && !todaysAttendance?.effectiveClockOut;
  const totalAllocated = (balances ?? []).reduce((sum, b) => sum + b.allocatedDays, 0);
  const totalRemaining = (balances ?? []).reduce((sum, b) => sum + b.remainingDays, 0);

  return (
    <div className="space-y-6">
      {/* Greeting + clock */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold">Hello{me ? `, ${me.firstName}` : ''}</p>
            <p className="text-sm text-muted-foreground">
              Your workday at a glance
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => clockMutation.mutate(isClockedIn ? 'clock_out' : 'clock_in')}
              disabled={clockMutation.isPending}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                isClockedIn
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {clockMutation.isPending
                ? 'Recording…'
                : isClockedIn
                  ? 'Clock out'
                  : 'Clock in'}
            </button>
            {clockNotice && <p className="text-sm text-muted-foreground">{clockNotice}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Today's shift */}
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s shift</CardTitle>
          <CardDescription>
            {todaysShift ? 'Your assignment for today' : 'No shift assigned today'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {todaysShift ? (
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="font-medium">{todaysShift.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatTime(todaysShift.startAt)} – {formatTime(todaysShift.endAt)}
                  {todaysShift.branch ? ` · ${todaysShift.branch.name}` : ''}
                </p>
              </div>
              <StatusBadge status={todaysShift.status} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enjoy your day off. You can request leave or check upcoming shifts below.
            </p>
          )}
        </CardContent>
      </Card>

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
          <CardTitle>Upcoming shifts</CardTitle>
          <CardDescription>Next 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          {shiftsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming shifts.</p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((shift: ShiftDetail) => (
                <li key={shift.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium">{shift.name}</p>
                    <p className="text-xs text-muted-foreground">
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
        <Link href="/schedule" className="rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors">
          <p className="font-medium">My Schedule</p>
          <p className="text-sm text-muted-foreground">View your shifts</p>
        </Link>
        <Link href="/leave" className="rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors">
          <p className="font-medium">Request Leave</p>
          <p className="text-sm text-muted-foreground">Plan time off</p>
        </Link>
        <Link href="/attendance" className="rounded-lg border border-border p-4 hover:bg-muted/50 transition-colors">
          <p className="font-medium">Attendance</p>
          <p className="text-sm text-muted-foreground">Review your time</p>
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

function ManagerDashboard() {
  const queryClient = useQueryClient();
  const [reviewError, setReviewError] = useState<string | null>(null);

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchEmployees({ limit: 100 }),
    staleTime: 60 * 1000,
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

  return (
    <div className="space-y-6">
      {/* Team overview stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active employees"
          value={activeEmployees}
          tone="success"
          href="/workforce"
        />
        <StatCard
          label="Shifts this week"
          value={weekShifts?.length ?? 0}
          href="/schedule"
        />
        <StatCard
          label="Present today"
          value={present}
          tone="success"
          href="/attendance"
        />
        <StatCard
          label="Pending leave"
          value={pendingLeave?.length ?? 0}
          tone={pendingLeave && pendingLeave.length > 0 ? 'warning' : undefined}
          href="/leave"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today's attendance */}
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s attendance</CardTitle>
            <CardDescription>
              {present} present · {late} late · {absent} absent
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(dailyAttendance ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No attendance records yet today.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(dailyAttendance ?? []).slice(0, 8).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {a.employee.firstName} {a.employee.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.employee.branch?.name ?? '—'} · {formatTime(a.effectiveClockIn ?? a.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.totalWorkedMinutes > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {formatMinutes(a.totalWorkedMinutes)}
                        </span>
                      )}
                      <StatusBadge status={a.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Pending leave */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Pending leave requests</CardTitle>
              <CardDescription>Review and take action</CardDescription>
            </div>
            {reviewError && <p className="text-xs text-destructive">{reviewError}</p>}
          </CardHeader>
          <CardContent>
            {(pendingLeave ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(pendingLeave ?? []).slice(0, 6).map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {r.employee.firstName} {r.employee.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.leaveType.name} · {format(parseISO(r.startDate as string), 'MMM d')} –{' '}
                          {format(parseISO(r.endDate as string), 'MMM d')} ({r.requestedDays}d)
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => review.mutate({ id: r.id, action: 'approve' })}
                          disabled={review.isPending}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => review.mutate({ id: r.id, action: 'reject' })}
                          disabled={review.isPending}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* This week's shifts */}
      <Card>
        <CardHeader>
          <CardTitle>Shifts this week</CardTitle>
          <CardDescription>All assigned and open shifts, next 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          {(weekShifts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shifts scheduled in the next 7 days.{' '}
              <Link href="/schedule" className="text-primary hover:underline">
                Create one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(weekShifts ?? []).slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(s.startAt), 'EEE, MMM d')} · {formatTime(s.startAt)} –{' '}
                      {formatTime(s.endAt)} · {s.assignments.length} assigned
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}