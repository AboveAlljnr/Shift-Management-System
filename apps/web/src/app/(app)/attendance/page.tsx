'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Users, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Avatar } from '@/components/ui/avatar';
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
import { getAuthUser, getPersonaInfo, getPrimaryRole } from '@/lib/auth';
import { cn, formatTime, getInitials } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

const AVATAR_COLORS = ['#7C3AED', '#2563EB', '#DC2626', '#0891B2', '#059669', '#D97706', '#64748B', '#16A34A'];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}

function toLocalDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type ManagerView = 'attendance' | 'presence';

const STATUS_ROW_BG: Record<string, string> = {
  late: 'bg-amber-50/40',
  absent: 'bg-red-50/40',
  missing_clock_in: 'bg-red-50/40',
  missing_clock_out: 'bg-amber-50/40',
  on_leave: 'bg-violet-50/40',
  holiday: 'bg-slate-50/40',
  day_off: 'bg-slate-50/40',
};

export default function AttendancePage() {
  const user = getAuthUser();
  const persona = getPersonaInfo(user);
  const isManager = persona.role === 'OWNER' || persona.role === 'MANAGER' || persona.role === 'SUPERVISOR';
  const defaultTab: ManagerView = persona.role === 'SUPERVISOR' ? 'presence' : 'attendance';

  const [selectedDate, setSelectedDate] = useState(toLocalDateInput(new Date()));
  const [managerView, setManagerView] = useState<ManagerView>(defaultTab);

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
          title="Attendance & Time Records"
          subtitle={
            persona.role === 'SUPERVISOR'
              ? 'Floor presence radar and live geofence verification stream'
              : persona.role === 'OWNER'
                ? 'Company-wide attendance and labor hours audit'
                : persona.role === 'MANAGER'
                  ? 'Daily department attendance and timesheet management'
                  : 'Your personal time card and hours worked'
          }
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

        {isManager && (
          <div className="flex gap-1 w-fit max-w-full rounded-xl bg-slate-100 p-1">
            {(
              [
                ['attendance', 'Daily attendance', Users],
                ['presence', 'Presence exceptions', ShieldCheck],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setManagerView(id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-colors',
                  managerView === id ? 'bg-white text-brand shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon size={14} />
                {label}
                {id === 'presence' && presenceExceptions.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-red-100 text-red-600 px-1.5 py-0.5 text-[10px] font-bold">
                    {presenceExceptions.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {isManager ? (
          <>
          {managerView === 'attendance' && (
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
                      <TableRow key={rec.id} className={STATUS_ROW_BG[rec.status]}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar
                              initials={getInitials(`${rec.employee.firstName} ${rec.employee.lastName}`)}
                              color={colorFor(`${rec.employee.firstName} ${rec.employee.lastName}`)}
                              size="sm"
                            />
                            <div>
                              <p className="text-sm font-semibold text-slate-800">
                                {rec.employee.firstName} {rec.employee.lastName}
                              </p>
                              <p className="text-xs text-slate-400 sm:hidden">
                                {rec.effectiveClockIn ? formatTime(rec.effectiveClockIn) : '—'} → {rec.effectiveClockOut ? formatTime(rec.effectiveClockOut) : '—'}
                              </p>
                            </div>
                          </div>
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
          )}

          {managerView === 'presence' && (
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
                      <TableRow key={pv.id} className={pv.status === 'MISSED' || pv.status === 'OUTSIDE_GEOFENCE' ? STATUS_ROW_BG.late : undefined}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar
                              initials={getInitials(pv.employeeName)}
                              color={colorFor(pv.employeeName)}
                              size="sm"
                            />
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{pv.employeeName}</p>
                              <p className="text-xs text-slate-400">{pv.employeeNumber}</p>
                            </div>
                          </div>
                          {pv.status === 'OUTSIDE_GEOFENCE' && (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-red-600 font-medium">
                              <AlertTriangle size={11} /> Outside geofence
                            </p>
                          )}
                          {pv.status === 'MISSED' && (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-red-600 font-medium">
                              <AlertTriangle size={11} /> Missed the check-in window
                            </p>
                          )}
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
          )}
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