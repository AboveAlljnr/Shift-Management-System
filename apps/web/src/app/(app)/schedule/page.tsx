'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  assignEmployeeToShift,
  createShift,
  fetchBranches,
  fetchDepartments,
  fetchEmployees,
  fetchShifts,
  type ShiftDetail,
} from '@/lib/api/queries';
import { cn, formatTime } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface ConflictItem {
  type: string;
  severity: string;
  ruleIdentifier: string;
  message: string;
  overrideAllowed: boolean;
}

function extractConflicts(err: unknown): { message: string; conflicts?: ConflictItem[]; warnings?: ConflictItem[] } {
  const axiosError = err as { response?: { data?: { message?: string | string[]; conflicts?: ConflictItem[]; warnings?: ConflictItem[] } } };
  const data = axiosError.response?.data;
  const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
  return { message: message ?? 'Something went wrong', conflicts: data?.conflicts, warnings: data?.warnings };
}

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function SchedulePage() {
  const queryClient = useQueryClient();

  const { data: shifts, isLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => fetchShifts(),
    staleTime: 30 * 1000,
  });

  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => fetchEmployees({ limit: 100 }) });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    branchId: '',
    departmentId: '',
    startAt: '',
    endAt: '',
    notes: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createShift({
        branchId: form.branchId,
        departmentId: form.departmentId || undefined,
        name: form.name,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowCreate(false);
      setForm({ name: '', branchId: '', departmentId: '', startAt: '', endAt: '', notes: '' });
      setFormError(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Unable to create shift'),
  });

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) return setFormError('Shift name is required');
    if (!form.branchId) return setFormError('Branch is required');
    if (!form.startAt || !form.endAt) return setFormError('Start and end times are required');
    if (new Date(form.endAt) <= new Date(form.startAt)) return setFormError('End time must be after start time');
    create.mutate();
  }

  const grouped = groupByDay(shifts ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
          <p className="text-sm text-muted-foreground">{(shifts ?? []).length} shifts · create, assign, and track</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          New shift
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No shifts yet</p>
            <p className="text-sm text-muted-foreground">Create a shift to start building your schedule.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, dayShifts]) => (
            <section key={day}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {format(parseISO(day), 'EEEE, MMMM d')}
              </h2>
              <div className="space-y-3">
                {dayShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    employees={employees?.data ?? []}
                    departments={departments ?? []}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-lg">
            <div className="border-b border-border p-5">
              <h2 className="text-lg font-semibold">New shift</h2>
              <p className="text-sm text-muted-foreground">Create a shift slot</p>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Shift name <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Morning opening"
                  className={inputClass}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Branch <span className="text-destructive">*</span>
                  </label>
                  <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className={inputClass}>
                    <option value="">Select…</option>
                    {(branches ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Department (optional)</label>
                  <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className={inputClass}>
                    <option value="">None</option>
                    {(departments ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Start <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.startAt}
                    onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    End <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.endAt}
                    onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className={inputClass}
                />
              </div>

              {formError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={create.isPending}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {create.isPending ? 'Saving…' : 'Create shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ShiftCard({
  shift,
  employees,
  departments,
}: {
  shift: ShiftDetail;
  employees: { id: string; firstName: string; lastName: string }[];
  departments: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<{ message?: string; conflicts?: ConflictItem[]; warnings?: ConflictItem[] } | null>(null);

  const assign = useMutation({
    mutationFn: () => assignEmployeeToShift(shift.id, { employeeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setResult(null);
      setEmployeeId('');
      setAssigning(false);
    },
    onError: (e) => {
      setResult(extractConflicts(e));
    },
  });

  const deptName = departments.find((d) => d.id === shift.departmentId)?.name;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{shift.name}</p>
            <StatusBadge status={shift.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatTime(shift.startAt)} – {formatTime(shift.endAt)}
            {shift.branch ? ` · ${shift.branch.name}` : ''}
            {deptName ? ` · ${deptName}` : ''}
          </p>
          {shift.assignments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {shift.assignments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                >
                  {a.employee.firstName} {a.employee.lastName}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={() => setAssigning((v) => !v)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
          >
            {assigning ? 'Cancel' : 'Assign'}
          </button>
          {assigning && (
            <div className="flex gap-2">
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={cn(inputClass, 'min-w-40')}>
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
              <button
                onClick={() => employeeId && assign.mutate()}
                disabled={!employeeId || assign.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {assign.isPending ? '…' : 'Assign'}
              </button>
            </div>
          )}
        </div>
      </CardContent>

      {(result?.message || result?.conflicts || result?.warnings) && (
        <div className="border-t border-border px-4 py-3">
          {result?.message && <p className="text-sm font-medium text-destructive">{result.message}</p>}
          {result?.conflicts?.map((c) => (
            <p key={c.ruleIdentifier + c.message} className="text-xs text-destructive">
              {c.message} (blocking)
            </p>
          ))}
          {result?.warnings?.map((w) => (
            <p key={w.ruleIdentifier + w.message} className="text-xs text-amber-600">
              {w.message} (warning)
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function groupByDay(shifts: ShiftDetail[]): [string, ShiftDetail[]][] {
  const map = new Map<string, ShiftDetail[]>();
  for (const s of [...shifts].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const day = s.startAt.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(s);
    map.set(day, list);
  }
  return Array.from(map.entries());
}