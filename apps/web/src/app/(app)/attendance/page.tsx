'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { fetchDailyAttendance, fetchEmployeeAttendance, fetchMyEmployee } from '@/lib/api/queries';
import { getAuthUser } from '@/lib/auth';
import { cn, formatTime } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

function toLocalDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AttendancePage() {
  const [selectedDate, setSelectedDate] = useState(toLocalDateInput(new Date()));
  const user = getAuthUser();
  const isManager = useMemo(() => {
    if (!user) return false;
    const roles = user.roles.map((r) => r.toLowerCase());
    return roles.some((r) => ['owner', 'admin', 'manager', 'shift_manager'].includes(r));
  }, [user]);

  const { data: me } = useQuery({ queryKey: ['myEmployee'], queryFn: fetchMyEmployee });

  const { data: daily, isLoading } = useQuery({
    queryKey: ['attendance', 'daily', selectedDate],
    queryFn: () => fetchDailyAttendance(selectedDate),
    staleTime: 30 * 1000,
  });

  const { data: myHistory } = useQuery({
    queryKey: ['attendance', 'me', selectedDate, me?.id],
    queryFn: () => fetchEmployeeAttendance(me?.id as string, { startDate: selectedDate, endDate: selectedDate }),
    enabled: !!me?.id && !isManager,
  });

  const today = selectedDate;
  const todayRecords = myHistory ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
          <p className="text-sm text-muted-foreground">
            {isManager ? 'Company-wide daily overview' : 'Your time and attendance'}
          </p>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid gap-6">
        {/* Today's summary cards */}
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Present" tone="success" value={(daily ?? []).filter((r) => ['present', 'late'].includes(r.status)).length} />
          <SummaryCard label="Late" tone="warning" value={(daily ?? []).filter((r) => r.status === 'late').length} />
          <SummaryCard label="Absent / missing" tone="danger" value={(daily ?? []).filter((r) => ['absent', 'missing_clock_in', 'missing_clock_out'].includes(r.status)).length} />
        </div>

        {isManager ? (
          <Card>
            <CardHeader>
              <CardTitle>Daily attendance — {format(parseISO(today), 'MMM d, yyyy')}</CardTitle>
              <CardDescription>Normalized records for all employees</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : (daily ?? []).length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">No attendance records for this day.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {(daily ?? []).map((rec) => (
                    <li key={rec.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {rec.employee.firstName} {rec.employee.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {rec.employee.branch?.name ?? '—'} · {rec.employee.department?.name ?? '—'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {rec.effectiveClockIn ? formatTime(rec.effectiveClockIn) : '—'} →
                          {rec.effectiveClockOut ? formatTime(rec.effectiveClockOut) : '—'}
                        </span>
                        {rec.totalWorkedMinutes > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {Math.floor(rec.totalWorkedMinutes / 60)}h {rec.totalWorkedMinutes % 60}m
                          </span>
                        )}
                        <StatusBadge status={rec.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>My record — {format(parseISO(today), 'MMM d, yyyy')}</CardTitle>
              <CardDescription>Your clock events and status</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {todayRecords.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">No attendance record for this day yet.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {todayRecords.map((rec) => (
                    <li key={rec.id} className="px-6 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusBadge status={rec.status} />
                        <span className="text-xs text-muted-foreground">
                          Clock in: {rec.effectiveClockIn ? formatTime(rec.effectiveClockIn) : '—'} · Clock out:{' '}
                          {rec.effectiveClockOut ? formatTime(rec.effectiveClockOut) : '—'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  const color =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : tone === 'danger'
          ? 'text-rose-700'
          : 'text-foreground';
  return (
    <Card>
      <CardContent className={cn('p-5', color)}>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}