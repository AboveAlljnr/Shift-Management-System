'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Users, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchDailyAttendance, fetchEmployeeAttendance, fetchMyEmployee, fetchPresenceVerifications } from '@/lib/api/queries';
import { getAuthUser } from '@/lib/auth';
import { formatTime } from '@/lib/utils';
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

  const { data: presenceVerifications } = useQuery({
    queryKey: ['presenceVerifications'],
    queryFn: () => fetchPresenceVerifications(),
    enabled: isManager,
    staleTime: 30 * 1000,
  });

  const presPresence = presenceVerifications ?? [];
  const presenceExceptions = presPresence.filter((p) => p.status === 'MISSED' || p.status === 'OUTSIDE_GEOFENCE');

  const today = selectedDate;
  const todayRecords = myHistory ?? [];

  const present = (daily ?? []).filter((r) => ['present', 'late'].includes(r.status)).length;
  const late = (daily ?? []).filter((r) => r.status === 'late').length;
  const absent = (daily ?? []).filter((r) => ['absent', 'missing_clock_in', 'missing_clock_out'].includes(r.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Attendance"
          subtitle={isManager ? 'Company-wide daily overview' : 'Your time and attendance'}
        />
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition sm:w-auto"
        />
      </div>

      <div className="grid gap-6">
        {/* Today's summary cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Present" value={present} sub={late > 0 ? `${late} late` : undefined} accent="#16A34A" icon={<Users size={16} />} />
          <StatCard label="Late" value={late} sub="Arrived after shift start" accent="#D97706" icon={<Clock size={16} />} />
          <StatCard label="Absent / missing" value={absent} sub="Requires attention" accent="#DC2626" icon={<AlertTriangle size={16} />} />
        </div>

        {isManager ? (
          <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold text-slate-900 font-sans">Daily attendance — {format(parseISO(today), 'MMM d, yyyy')}</CardTitle>
              <CardDescription>Normalized records for all employees</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-sm text-slate-500">Loading…</div>
              ) : (daily ?? []).length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <ClipboardCheck className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm text-slate-500">No attendance records for this day.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="hidden sm:table-cell">Clock in</TableHead>
                      <TableHead className="hidden sm:table-cell">Clock out</TableHead>
                      <TableHead className="hidden md:table-cell">Hours</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(daily ?? []).map((rec) => (
                      <TableRow key={rec.id}>
                        <TableCell>
                          <p className="text-sm font-semibold text-slate-800">
                            {rec.employee.firstName} {rec.employee.lastName}
                          </p>
                          <p className="text-xs text-slate-400 sm:hidden">
                            {rec.effectiveClockIn ? formatTime(rec.effectiveClockIn) : '—'} → {rec.effectiveClockOut ? formatTime(rec.effectiveClockOut) : '—'}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-slate-600">{rec.employee.branch?.name ?? '—'}</p>
                          <p className="text-xs text-slate-400">{rec.employee.department?.name ?? '—'}</p>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-slate-600 font-mono">
                          {rec.effectiveClockIn ? formatTime(rec.effectiveClockIn) : '—'}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-slate-600 font-mono">
                          {rec.effectiveClockOut ? formatTime(rec.effectiveClockOut) : '—'}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-slate-600 font-mono">
                          {rec.totalWorkedMinutes > 0 ? `${Math.floor(rec.totalWorkedMinutes / 60)}h ${rec.totalWorkedMinutes % 60}m` : '—'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={rec.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold text-slate-900 font-sans">
                Presence verification exceptions
              </CardTitle>
              <CardDescription>
                {presenceExceptions.length > 0
                  ? `${presenceExceptions.length} need attention`
                  : 'No missed or outside-geofence verifications'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {presPresence.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm text-slate-500">No presence verifications yet.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="hidden sm:table-cell">Due</TableHead>
                      <TableHead className="hidden sm:table-cell">Verified at</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {presPresence.map((pv) => (
                      <TableRow key={pv.id}>
                        <TableCell>
                          <p className="text-sm font-semibold text-slate-800">{pv.employeeName}</p>
                          <p className="text-xs text-slate-400">{pv.employeeNumber}</p>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{pv.branchName ?? '—'}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-slate-600 font-mono">
                          {pv.dueAt ? formatTime(pv.dueAt) : '—'}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-slate-600 font-mono">
                          {pv.verifiedAt ? formatTime(pv.verifiedAt) : '—'}
                        </TableCell>
                        <TableCell><StatusBadge status={pv.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold text-slate-900 font-sans">My record — {format(parseISO(today), 'MMM d, yyyy')}</CardTitle>
              <CardDescription>Your clock events and status</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {todayRecords.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <ClipboardCheck className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm text-slate-500">No attendance record for this day yet.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Clock in</TableHead>
                      <TableHead>Clock out</TableHead>
                      <TableHead className="hidden md:table-cell">Worked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {todayRecords.map((rec) => (
                      <TableRow key={rec.id}>
                        <TableCell><StatusBadge status={rec.status} /></TableCell>
                        <TableCell className="text-sm text-slate-600 font-mono">{rec.effectiveClockIn ? formatTime(rec.effectiveClockIn) : '—'}</TableCell>
                        <TableCell className="text-sm text-slate-600 font-mono">{rec.effectiveClockOut ? formatTime(rec.effectiveClockOut) : '—'}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-slate-600 font-mono">
                          {rec.totalWorkedMinutes > 0 ? `${Math.floor(rec.totalWorkedMinutes / 60)}h ${rec.totalWorkedMinutes % 60}m` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
          <p className="text-3xl font-bold text-slate-900 font-sans">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${accent}18`, color: accent }}>
          {icon}
        </div>
      </div>
    </Card>
  );
}