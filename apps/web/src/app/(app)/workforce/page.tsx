'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BadgeCheck,
  Calendar,
  ChevronRight,
  Clock,
  Mail,
  Search,
  Star,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  createEmployee,
  deactivateEmployee,
  fetchBranches,
  fetchCertifications,
  fetchDepartments,
  fetchEmployeeAttendance,
  fetchEmployeeQualifications,
  fetchEmployees,
  fetchEmploymentTypes,
  fetchLeaveBalances,
  fetchLeaveRequests,
  fetchMyShifts,
  fetchPositions,
  fetchSkills,
  setEmployeeCertifications,
  setEmployeeSkills,
  type AttendanceRecordDetail,
  type EmployeeDetail,
  type EmployeeQualifications,
  type LeaveRequestDetail,
} from '@/lib/api/queries';
import { getAuthUser, hasRole } from '@/lib/auth';
import { cn, formatTime, getInitials } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

type NewEmployee = {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentTypeId: string;
  branchId: string;
  departmentId: string;
  primaryPositionId: string;
  hireDate: string;
};

const emptyForm: NewEmployee = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  employmentTypeId: '',
  branchId: '',
  departmentId: '',
  primaryPositionId: '',
  hireDate: new Date().toISOString().slice(0, 10),
};

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

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const ATTENDANCE_BADGE: Record<
  string,
  { variant: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; label: string }
> = {
  present: { variant: 'success', label: 'On Time' },
  late: { variant: 'warning', label: 'Late' },
  absent: { variant: 'danger', label: 'Absent' },
  on_leave: { variant: 'info', label: 'On Leave' },
  holiday: { variant: 'neutral', label: 'Holiday' },
  day_off: { variant: 'neutral', label: 'Day Off' },
  missing_clock_in: { variant: 'danger', label: 'Missing Clock-in' },
  missing_clock_out: { variant: 'warning', label: 'Missing Clock-out' },
  early_departure: { variant: 'warning', label: 'Left Early' },
};

const LEAVE_STATUS_BADGE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  cancelled: 'neutral',
};

const PROFILE_TABS = ['Overview', 'Schedule', 'Attendance', 'Leave', 'Skills'];

export default function WorkforcePage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewEmployee>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmployeeDetail | null>(null);
  const [qualsEmployee, setQualsEmployee] = useState<
    { id: string; firstName: string; lastName: string; employeeNumber: string } | null
  >(null);

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees', search],
    queryFn: () => fetchEmployees(search ? { search } : { limit: 100 }),
    staleTime: 30 * 1000,
  });

  const { data: employmentTypes } = useQuery({ queryKey: ['employment-types'], queryFn: fetchEmploymentTypes });
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: fetchPositions });

  const list = useMemo(() => employees?.data ?? [], [employees]);
  const total = employees?.pagination.total ?? 0;
  const activeCount = useMemo(
    () => list.filter((e) => e.status === 'active').length,
    [list],
  );

  const filtered = useMemo(
    () =>
      list.filter(
        (e) =>
          (branchFilter === 'all' || e.branchId === branchFilter) &&
          (statusFilter === 'all' ||
            (statusFilter === 'active' && e.status === 'active') ||
            (statusFilter === 'on_leave' && e.status === 'on_leave')),
      ),
    [list, branchFilter, statusFilter],
  );

  const create = useMutation({
    mutationFn: () =>
      createEmployee({
        employeeNumber: form.employeeNumber,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || undefined,
        employmentTypeId: form.employmentTypeId,
        branchId: form.branchId || undefined,
        departmentId: form.departmentId || undefined,
        primaryPositionId: form.primaryPositionId || undefined,
        hireDate: new Date(form.hireDate + 'T00:00:00.000Z').toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setShowCreate(false);
      setForm(emptyForm);
      setFormError(null);
    },
    onError: (e) => {
      setFormError(e instanceof Error ? e.message : 'Unable to create employee');
    },
  });

  const deactivate = useMutation({
    mutationFn: deactivateEmployee,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.employeeNumber.trim()) return setFormError('Employee number is required');
    if (!form.firstName.trim() || !form.lastName.trim()) return setFormError('Name fields are required');
    if (!form.email.trim()) return setFormError('Email is required');
    if (!form.employmentTypeId) return setFormError('Employment type is required');
    if (!form.hireDate) return setFormError('Hire date is required');
    create.mutate();
  }

  if (selected) {
    return (
      <EmployeeProfile
        employee={selected}
        onBack={() => setSelected(null)}
        onManageQualifications={(emp) =>
          setQualsEmployee({ id: emp.id, firstName: emp.firstName, lastName: emp.lastName, employeeNumber: emp.employeeNumber })
        }
      >
        {qualsEmployee && <QualificationsModal employee={qualsEmployee} onClose={() => setQualsEmployee(null)} />}
      </EmployeeProfile>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Workforce"
          subtitle={`${total} people · ${activeCount} active`}
        />
        <Button onClick={() => setShowCreate(true)}>
          <Users size={15} className="mr-1.5" />
          Add employee
        </Button>
      </div>

      {/* Filter card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-52">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or employee number…"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
              />
            </div>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
            >
              <option value="all">All branches</option>
              {(branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="on_leave">On leave</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Users className="h-8 w-8 text-slate-400" />
            <p className="font-medium">No employees found</p>
            <p className="text-sm text-slate-500">Try adjusting your search or filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Employee', 'Position', 'Branch', 'Department / Team', 'Type', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((emp) => (
                  <tr
                    key={emp.id}
                    onClick={() => setSelected(emp)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar
                          initials={getInitials(`${emp.firstName} ${emp.lastName}`)}
                          color={colorFor(`${emp.firstName} ${emp.lastName}`)}
                          size="md"
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-xs text-slate-400">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-700">
                      {emp.primaryPosition?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-700">{emp.branch?.name ?? '—'}</td>
                    <td className="px-4 py-3.5">
                      <p className="text-sm text-slate-700">{emp.department?.name ?? '—'}</p>
                      <p className="text-xs text-slate-400">{emp.team?.name ?? ''}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant="neutral">{emp.employmentType?.name ?? 'Standard'}</Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={emp.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <ChevronRight size={16} className="text-slate-300 ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
            Showing {filtered.length} of {total} employees
          </div>
        </Card>
      )}

      {qualsEmployee && <QualificationsModal employee={qualsEmployee} onClose={() => setQualsEmployee(null)} />}

      {/* Add employee modal */}
      <Modal open={showCreate} onOpenChange={setShowCreate}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add employee</ModalTitle>
            <ModalDescription>Create a new employee profile</ModalDescription>
          </ModalHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee number" required>
                <input
                  value={form.employeeNumber}
                  onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })}
                  placeholder="EMP-002"
                  className={inputClass}
                />
              </Field>
              <Field label="Hire date" required>
                <input
                  type="date"
                  value={form.hireDate}
                  onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="First name" required>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Last name" required>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Email" required>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Phone">
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Employment type" required>
                <select
                  value={form.employmentTypeId}
                  onChange={(e) => setForm({ ...form, employmentTypeId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {(employmentTypes ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Branch">
                <select
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Department">
                <select
                  value={form.departmentId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {(departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Primary position">
                <select
                  value={form.primaryPositionId}
                  onChange={(e) => setForm({ ...form, primaryPositionId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {(positions ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                {formError}
              </div>
            )}

            <ModalFooter className="pt-2">
              <ModalClose asChild>
                <Button variant="secondary">Cancel</Button>
              </ModalClose>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Saving…' : 'Save employee'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

// ── Employee profile ──────────────────────────────────────────────────────────

function EmployeeProfile({
  employee,
  onBack,
  onManageQualifications,
  children,
}: {
  employee: EmployeeDetail;
  onBack: () => void;
  onManageQualifications: (emp: { id: string; firstName: string; lastName: string; employeeNumber: string }) => void;
  children?: React.ReactNode;
}) {
  const [tab, setTab] = useState('Overview');
  const today = new Date();

  const empShiftsQuery = useQuery({
    queryKey: ['shifts', 'employee', employee.id],
    queryFn: () => fetchMyShifts(employee.id),
    staleTime: 60 * 1000,
  });
  const empShifts = empShiftsQuery.data ?? [];

  const todayISO = toISODate(today);
  const weekStartISO = toISODate(startOfWeek(today));
  const weekEndISO = toISODate(addDays(startOfWeek(today), 7));
  const nextMonthISO = toISODate(addDays(today, 30));

  const { data: attendance = [] } = useQuery({
    queryKey: ['attendance', 'employee', employee.id],
    queryFn: () => fetchEmployeeAttendance(employee.id, { startDate: toISODate(addDays(today, -31)) } as { startDate: string; endDate?: string }),
    staleTime: 60 * 1000,
  });

  const { data: leaveRequests = [] } = useQuery({
    queryKey: ['leave', 'employee', employee.id],
    queryFn: () => fetchLeaveRequests({ employeeId: employee.id }),
    staleTime: 60 * 1000,
  });

  const { data: balances = [] } = useQuery({
    queryKey: ['leave-balances', employee.id],
    queryFn: () => fetchLeaveBalances(employee.id),
    staleTime: 60 * 1000,
  });

  const { data: quals } = useQuery({
    queryKey: ['employeeQualifications', employee.id],
    queryFn: () => fetchEmployeeQualifications(employee.id),
  });

  const thisWeekShifts = empShifts.filter(
    (s) => s.startAt.slice(0, 10) >= weekStartISO && s.startAt.slice(0, 10) < weekEndISO,
  );
  const upcomingShifts = empShifts
    .filter((s) => s.startAt.slice(0, 10) >= todayISO && s.status !== 'cancelled')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, 3);

  const totalMinutes = attendance.reduce((sum, a) => sum + (a.totalWorkedMinutes ?? 0), 0);
  const graded = attendance.filter((a) => a.status === 'present' || a.status === 'late' || a.status === 'early_departure' || a.status === 'missing_clock_in');
  const onTimeRate =
    graded.length > 0
      ? Math.round((attendance.filter((a) => a.status === 'present').length / graded.length) * 100)
      : null;
  const lateCount = attendance.filter(
    (a) => a.status === 'late' || a.status === 'early_departure' || a.status === 'missing_clock_in',
  ).length;

  const color = colorFor(`${employee.firstName} ${employee.lastName}`);
  const isExpired = (expiresAt?: string | null) => !!expiresAt && new Date(expiresAt).getTime() < Date.now();

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} /> Back to Employees
      </button>

      {/* Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start gap-6">
            <Avatar initials={getInitials(`${employee.firstName} ${employee.lastName}`)} color={color} size="xl" />
            <div className="flex-1 min-w-60">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 font-sans">
                    {employee.firstName} {employee.lastName}
                  </h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {employee.primaryPosition?.name ?? employee.department?.name ?? 'Employee'} · {employee.employeeNumber}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge status={employee.status} />
                    {employee.employmentType && (
                      <Badge variant="neutral">{employee.employmentType.name}</Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Mail size={13} /> {employee.email}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Calendar size={13} /> Since{' '}
                  {format(parseISO(employee.hireDate), 'MMM yyyy')}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock size={13} />
                  {employee.manager ? `Reports to ${employee.manager.firstName} ${employee.manager.lastName}` : 'No manager'}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {PROFILE_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px',
              tab === t
                ? 'text-brand border-brand'
                : 'text-slate-500 hover:text-slate-700 border-transparent',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardContent className="p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Organization</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[
                    { label: 'Branch', value: employee.branch?.name ?? '—' },
                    { label: 'Department', value: employee.department?.name ?? '—' },
                    { label: 'Team', value: employee.team?.name ?? '—' },
                    { label: 'Position', value: employee.primaryPosition?.name ?? '—' },
                    { label: 'Employment Type', value: employee.employmentType?.name ?? '—' },
                    {
                      label: 'Manager',
                      value: employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—',
                    },
                  ].map((f) => (
                    <div key={f.label}>
                      <p className="text-xs text-slate-400 mb-0.5">{f.label}</p>
                      <p className="text-sm font-semibold text-slate-800">{f.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Upcoming Shifts</h3>
                {upcomingShifts.length === 0 ? (
                  <p className="text-xs text-slate-400">No upcoming shifts in the next 30 days.</p>
                ) : (
                  <div>
                    {upcomingShifts.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0"
                      >
                        <div className="w-10 h-10 rounded-xl bg-brand/8 flex items-center justify-center text-brand">
                          <Calendar size={16} />
                        </div>
                        <div className="text-sm font-semibold text-slate-800">
                          {format(parseISO(s.startAt), 'EEEE, MMM d')}
                        </div>
                        <p className="text-xs text-slate-400 ml-auto">
                          {formatTime(s.startAt)} – {formatTime(s.endAt)}
                        </p>
                        <Badge variant={s.status === 'published' ? 'success' : 'warning'}>
                          {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardContent className="p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Skills</h3>
                {!quals || quals.skills.length === 0 ? (
                  <p className="text-xs text-slate-400">No skills assigned.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {quals.skills.map((s) => (
                      <span
                        key={s.skillId}
                        className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
                      >
                        {s.skill?.name ?? s.skillId}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Certifications</h3>
                {!quals || quals.certifications.length === 0 ? (
                  <p className="text-xs text-slate-400">No certifications on file.</p>
                ) : (
                  <div className="space-y-2">
                    {quals.certifications.map((c) => {
                      const expired = isExpired(c.expiresAt);
                      return (
                        <div
                          key={c.certificationId}
                          className={cn(
                            'flex items-center gap-2.5 p-2.5 rounded-lg border',
                            expired
                              ? 'bg-red-50 border-red-100'
                              : 'bg-green-50 border-green-100',
                          )}
                        >
                          <Star size={13} className={expired ? 'text-red-500' : 'text-green-600'} />
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-xs font-semibold truncate', expired ? 'text-red-700' : 'text-green-700')}>
                              {c.certification?.name ?? c.certificationId}
                            </p>
                            {c.expiresAt && (
                              <p className={cn('text-[10px]', expired ? 'text-red-500' : 'text-green-600')}>
                                {expired ? 'Expired' : 'Expires'}{' '}
                                {format(parseISO(c.expiresAt), 'MMM d, yyyy')}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {balances.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Leave Balance</h3>
                  {balances.slice(0, 3).map((b) => (
                    <div key={b.id} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                      <span className="text-xs text-slate-600">{b.leaveType.name}</span>
                      <span className="text-xs font-bold text-slate-800">{b.remainingDays}d</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'Schedule' && (
        <Card>
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 font-sans">
              This Week&apos;s Shifts — {format(parseISO(weekStartISO), 'MMM d')}–{format(parseISO(toISODate(addDays(startOfWeek(today), 6))), 'MMM d')}
            </h3>
          </div>
          {thisWeekShifts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No shifts scheduled this week.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {thisWeekShifts.map((s) => (
                <div key={s.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0">
                    <Calendar size={16} className="text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {format(parseISO(s.startAt), 'EEEE, MMM d')}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatTime(s.startAt)} – {formatTime(s.endAt)} · {s.department?.name ?? '—'}
                      {s.team ? ` / ${s.team.name}` : ''}
                    </p>
                  </div>
                  <Badge variant={s.status === 'published' ? 'success' : 'warning'}>
                    {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'Attendance' && (
        <Card>
          <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <h3 className="text-sm font-bold text-slate-900 font-sans">Attendance — Last 30 days</h3>
            <div className="grid grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-lg font-bold text-slate-900 font-mono">
                  {Math.round(totalMinutes / 60)}h
                </p>
                <p className="text-[10px] text-slate-400">Hours worked</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-600 font-mono">
                  {onTimeRate === null ? '—' : `${onTimeRate}%`}
                </p>
                <p className="text-[10px] text-slate-400">On-time rate</p>
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900 font-mono">{lateCount}</p>
                <p className="text-[10px] text-slate-400">Late arrivals</p>
              </div>
            </div>
          </div>
          {attendance.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              No attendance records in the last 30 days.
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {[...attendance]
                .sort((a, b) => b.workDate.localeCompare(a.workDate))
                .slice(0, 15)
                .map((a: AttendanceRecordDetail) => {
                  const badge = ATTENDANCE_BADGE[a.status] ?? { variant: 'neutral' as const, label: a.status };
                  return (
                    <div key={a.id} className="px-5 py-4 flex flex-wrap items-center gap-4">
                      <p className="w-28 text-xs font-semibold text-slate-600 flex-shrink-0">
                        {format(parseISO(a.workDate), 'EEE, MMM d')}
                      </p>
                      <p className="flex-1 text-xs font-medium text-slate-700">
                        In: {a.effectiveClockIn ? formatTime(a.effectiveClockIn) : '—'} · Out:{' '}
                        {a.effectiveClockOut ? formatTime(a.effectiveClockOut) : '—'}
                      </p>
                      <p className="text-xs font-mono text-slate-600 w-16 text-right">
                        {a.totalWorkedMinutes > 0
                          ? `${Math.floor(a.totalWorkedMinutes / 60)}h ${a.totalWorkedMinutes % 60}m`
                          : '—'}
                      </p>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      )}

      {tab === 'Leave' && (
        <div className="space-y-4">
          {balances.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {balances.slice(0, 3).map((b) => {
                const pct = b.allocatedDays > 0 ? b.remainingDays / b.allocatedDays : 0;
                return (
                  <Card key={b.id}>
                    <CardContent className="p-5">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        {b.leaveType.name}
                      </p>
                      <p className="text-3xl font-bold text-slate-900 font-sans">{b.remainingDays}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        of {b.allocatedDays} days · {b.usedDays} used
                      </p>
                      <div className="mt-3 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-brand rounded-full"
                          style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <Card>
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 font-sans">Leave History</h3>
            </div>
            {leaveRequests.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">No leave requests found.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {leaveRequests.map((l: LeaveRequestDetail) => (
                  <div key={l.id} className="px-5 py-4 flex flex-wrap items-center gap-4">
                    <div className="flex-1 min-w-40">
                      <p className="text-sm font-semibold text-slate-800">{l.leaveType.name}</p>
                      <p className="text-xs text-slate-400">
                        {format(parseISO(l.startDate), 'MMM d, yyyy')} –{' '}
                        {format(parseISO(l.endDate), 'MMM d, yyyy')} · {l.requestedDays} days
                      </p>
                    </div>
                    <Badge variant={LEAVE_STATUS_BADGE[l.status] ?? 'neutral'}>
                      {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'Skills' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Skills</h3>
              </div>
              {!quals || quals.skills.length === 0 ? (
                <p className="text-sm text-slate-400">No skills assigned.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {quals.skills.map((s) => (
                    <span
                      key={s.skillId}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
                    >
                      <BadgeCheck size={12} className="text-brand" />
                      {s.skill?.name ?? s.skillId}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Certifications</h3>
              {!quals || quals.certifications.length === 0 ? (
                <p className="text-sm text-slate-400">No certifications on file.</p>
              ) : (
                <div className="space-y-3">
                  {quals.certifications.map((c) => {
                    const expired = isExpired(c.expiresAt);
                    return (
                      <div
                        key={c.certificationId}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-xl border',
                          expired ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100',
                        )}
                      >
                        <Star size={16} className={expired ? 'text-red-500' : 'text-green-600'} />
                        <div className="flex-1">
                          <p className={cn('text-sm font-semibold', expired ? 'text-red-800' : 'text-green-800')}>
                            {c.certification?.name ?? c.certificationId}
                          </p>
                          <p className={cn('text-xs', expired ? 'text-red-600' : 'text-green-600')}>
                            {c.expiresAt
                              ? expired
                                ? `Expired ${format(parseISO(c.expiresAt), 'MMM d, yyyy')}`
                                : `Valid · Expires ${format(parseISO(c.expiresAt), 'MMM yyyy')}`
                              : 'Valid · No expiry'}
                          </p>
                        </div>
                        <Badge variant={expired ? 'danger' : 'success'}>
                          {expired ? 'Expired' : 'Valid'}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button
                variant="secondary"
                className="w-full mt-4"
                onClick={() =>
                  onManageQualifications({
                    id: employee.id,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    employeeNumber: employee.employeeNumber,
                  })
                }
              >
                Manage qualifications
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {children}
    </div>
  );
}

// ── Qualifications modal (edit skills / certifications) ──────────────────────

function QualificationsModal({
  employee,
  onClose,
}: {
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const canEdit = hasRole(getAuthUser(), ['admin', 'manager']);

  const { data: quals, isLoading: qualsLoading } = useQuery({
    queryKey: ['employeeQualifications', employee.id],
    queryFn: () => fetchEmployeeQualifications(employee.id),
  });
  const { data: skillCatalog = [] } = useQuery({ queryKey: ['skills'], queryFn: fetchSkills });
  const { data: certCatalog = [] } = useQuery({
    queryKey: ['certifications'],
    queryFn: fetchCertifications,
  });

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const activeSkills = skillCatalog.filter((s) => s.isActive);
  const activeCerts = certCatalog.filter((c) => c.isActive);

  const [skillDraft, setSkillDraft] = useState<Set<string>>(new Set());
  const [certDraft, setCertDraft] = useState<
    Map<string, { issuedAt: string; expiresAt: string; issuer?: string }>
  >(new Map());
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!quals || touched) return;
    setSkillDraft(new Set(quals.skills.map((s) => s.skillId)));
    const newDraft = new Map<string, { issuedAt: string; expiresAt: string; issuer?: string }>();
    for (const c of quals.certifications) {
      newDraft.set(c.certificationId, {
        issuedAt: (c.issuedAt ?? today).slice(0, 10),
        expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
        issuer: c.issuer ?? undefined,
      });
    }
    setCertDraft(newDraft);
    setTouched(true);
  }, [quals, touched, today]);

  const toggleSkill = (skillId: string) => {
    setNotice(null);
    setSkillDraft((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const toggleCert = (certificationId: string) => {
    setNotice(null);
    setError(null);
    setCertDraft((prev) => {
      const next = new Map(prev);
      if (next.has(certificationId)) {
        next.delete(certificationId);
      } else {
        next.set(certificationId, {
          issuedAt: today,
          expiresAt: '',
          issuer: undefined,
        });
      }
      return next;
    });
  };

  const setCertExpiry = (certificationId: string, expiresAt: string) => {
    setCertDraft((prev) => {
      const next = new Map(prev);
      const existing = next.get(certificationId);
      if (existing) next.set(certificationId, { ...existing, expiresAt });
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const skills = [...skillDraft].map((skillId) => ({ skillId }));
      const certifications = [...certDraft.entries()].map(([certificationId, meta]) => ({
        certificationId,
        issuedAt: new Date(meta.issuedAt + 'T00:00:00.000Z').toISOString(),
        expiresAt: meta.expiresAt
          ? new Date(meta.expiresAt + 'T00:00:00.000Z').toISOString()
          : undefined,
        issuer: meta.issuer || undefined,
      }));
      const [a, b] = await Promise.all([
        setEmployeeSkills(employee.id, skills),
        setEmployeeCertifications(employee.id, certifications),
      ]);
      return a && b;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employeeQualifications', employee.id] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setNotice('Qualifications saved.');
      setSaving(false);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Unable to save qualifications');
      setSaving(false);
    },
  });

  const handleSave = () => {
    setError(null);
    setNotice(null);
    setSaving(true);
    if ([...certDraft.values()].some((c) => c.expiresAt && c.expiresAt < today)) {
      setSaving(false);
      setError('Expiry dates cannot be in the past.');
      return;
    }
    save.mutate();
  };

  const isExpired = (expiresAt?: string | null) => !!expiresAt && new Date(expiresAt).getTime() < Date.now();

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>Qualifications — {employee.firstName} {employee.lastName}</ModalTitle>
          <ModalDescription>
            Skills and certification records. These drive eligibility for open shifts and
            required-coverage assignments.
            {!canEdit && ' View only — ask a manager to edit.'}
          </ModalDescription>
        </ModalHeader>

        {qualsLoading ? (
          <div className="space-y-3">
            <div className="h-8 animate-pulse rounded-lg bg-muted" />
            <div className="h-8 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : (
          <div className="space-y-5 max-h-[50vh] overflow-y-auto pr-1">
            <section>
              <div className="mb-2 flex items-center gap-2">
                <BadgeCheck size={16} className="text-brand" />
                <h3 className="text-sm font-bold text-slate-800">Skills</h3>
                <span className="text-xs text-slate-400">{skillDraft.size} selected</span>
              </div>
              {activeSkills.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No skills in the catalog yet. A manager can add skills in the organization setup.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeSkills.map((s) => {
                    const selected = skillDraft.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => toggleSkill(s.id)}
                        className={
                          selected
                            ? 'inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white transition'
                            : 'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/50'
                        }
                      >
                        {s.name}
                        {selected && <BadgeCheck size={12} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <Award size={16} className="text-brand" />
                <h3 className="text-sm font-bold text-slate-800">Certifications</h3>
                <span className="text-xs text-slate-400">{certDraft.size} selected</span>
              </div>
              {activeCerts.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No certifications in the catalog yet. Food handling, safety, and similar
                  credentials are configured by a manager.
                </p>
              ) : (
                <div className="space-y-3">
                  {activeCerts.map((c) => {
                    const meta = certDraft.get(c.id);
                    const existing = quals?.certifications.find((x) => x.certificationId === c.id);
                    const expired = meta
                      ? meta.expiresAt && meta.expiresAt < today
                      : isExpired(existing?.expiresAt);
                    return (
                      <div key={c.id} className="rounded-xl border border-slate-200 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => toggleCert(c.id)}
                              className={
                                meta
                                  ? 'inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white transition'
                                  : 'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/50'
                              }
                            >
                              {c.name}
                              {meta && <BadgeCheck size={12} />}
                            </button>
                            {existing && isExpired(existing.expiresAt) && !meta && (
                              <Badge variant="danger">Expired</Badge>
                            )}
                            {c.validityPeriodDays != null && (
                              <span className="text-xs text-slate-400">
                                valid {c.validityPeriodDays} days
                              </span>
                            )}
                          </div>
                          {existing && !meta && (
                            <span className="text-xs text-slate-400">
                              {existing.issuedAt
                                ? `Issued ${format(parseISO(existing.issuedAt), 'MMM d, yyyy')}`
                                : ''}
                              {existing.expiresAt
                                ? ` · expires ${format(parseISO(existing.expiresAt), 'MMM d, yyyy')}`
                                : ''}
                            </span>
                          )}
                        </div>
                        {meta && (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2 text-xs text-slate-500">
                              Expires
                              <input
                                type="date"
                                value={meta.expiresAt}
                                min={today}
                                onChange={(e) => setCertExpiry(c.id, e.target.value)}
                                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                              />
                            </label>
                            <span className="text-xs text-slate-400">
                              Issued today · leave expiry blank if it never expires
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {(error || notice) && (
          <div
            className={
              error
                ? 'rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600'
                : 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800'
            }
          >
            {error ?? notice}
          </div>
        )}

        <ModalFooter className="pt-2">
          <ModalClose asChild>
            <Button variant="secondary">Close</Button>
          </ModalClose>
          {canEdit && (
            <Button onClick={handleSave} disabled={saving || save.isPending || qualsLoading}>
              {saving || save.isPending ? 'Saving…' : 'Save qualifications'}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}