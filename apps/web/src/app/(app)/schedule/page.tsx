'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Plus, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalClose,
} from '@/components/ui/modal';
import {
  applyScheduleSuggestions,
  assignEmployeeToShift,
  createShift,
  fetchBranches,
  fetchDepartments,
  fetchEmployees,
  fetchShifts,
  generateScheduleSuggestions,
  type ScheduleSuggestion,
  type ShiftDetail,
  type SuggestedAssignment,
} from '@/lib/api/queries';
import { formatTime } from '@/lib/utils';
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
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';

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
  const [showGenerate, setShowGenerate] = useState(false);
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
          <h1 className="text-xl font-bold text-slate-900 font-sans">Schedule</h1>
          <p className="text-sm text-slate-500 mt-0.5">{(shifts ?? []).length} shifts · create, assign, and track</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowGenerate(true)} className="gap-2">
            <Sparkles size={14} className="text-brand" />
            Smart Schedule Optimizer
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)} className="gap-2">
            <Plus size={14} />
            New shift
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-200/60" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Calendar className="h-8 w-8 text-slate-400" />
            <p className="font-semibold text-slate-700">No shifts yet</p>
            <p className="text-sm text-slate-500">Create a shift to start building your schedule.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, dayShifts]) => (
            <section key={day}>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
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

      <Modal open={showCreate} onOpenChange={setShowCreate}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>New shift</ModalTitle>
            <ModalDescription>Create a shift slot</ModalDescription>
          </ModalHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Shift name <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Morning opening"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Branch <span className="text-red-500">*</span>
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
                <label className="text-sm font-medium text-slate-700">Department (optional)</label>
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
                <label className="text-sm font-medium text-slate-700">
                  Start <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  End <span className="text-red-500">*</span>
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
              <label className="text-sm font-medium text-slate-700">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className={inputClass}
              />
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
                {create.isPending ? 'Saving…' : 'Create shift'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {showGenerate && (
        <GenerateSuggestionsDialog
          branches={branches ?? []}
          departments={departments ?? []}
          employees={employees?.data ?? []}
          shifts={shifts ?? []}
          onClose={() => setShowGenerate(false)}
        />
      )}
    </div>
  );
}

interface BranchItem {
  id: string;
  name: string;
}

interface DepartmentItem {
  id: string;
  name: string;
}

interface EmployeeItem {
  id: string;
  firstName: string;
  lastName: string;
}

function GenerateSuggestionsDialog({
  branches,
  departments,
  employees,
  shifts,
  onClose,
}: {
  branches: BranchItem[];
  departments: DepartmentItem[];
  employees: EmployeeItem[];
  shifts: ShiftDetail[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ScheduleSuggestion | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const employeeName = (id: string) => {
    const e = employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}` : 'Unknown';
  };
  const shiftName = (id: string) => shifts.find((s) => s.id === id)?.name ?? 'Unknown shift';

  const generate = useMutation({
    mutationFn: () =>
      generateScheduleSuggestions({
        branchId,
        departmentId: departmentId || undefined,
        startDate,
        endDate,
      }),
    onSuccess: (data) => {
      setSuggestion(data);
      setError(null);
      setApplyMsg(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Unable to generate suggestions'),
  });

  const apply = useMutation({
    mutationFn: () =>
      applyScheduleSuggestions(
        { branchId, startDate, endDate },
        (suggestion?.assignments ?? []).map((a) => ({ shiftId: a.shiftId, employeeId: a.employeeId })),
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setApplyMsg(
        `${data.accepted.length} applied · ${data.skipped.length} already assigned · ${data.rejected.length} rejected due to conflicts`,
      );
      setSuggestion(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Unable to apply suggestions'),
  });

  function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuggestion(null);
    setApplyMsg(null);
    if (!branchId) return setError('Branch is required');
    if (!startDate || !endDate) return setError('Start and end dates are required');
    if (new Date(endDate) < new Date(startDate)) return setError('End date must be on or after start date');
    setError(null);
    generate.mutate();
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <div className="flex items-center gap-2 pt-1">
            <div className="w-8 h-8 rounded-lg bg-brand-light flex items-center justify-center">
              <Sparkles size={16} className="text-brand" />
            </div>
            <ModalTitle>Smart Schedule Optimizer</ModalTitle>
          </div>
          <ModalDescription>
            Generate a constraint-aware schedule using workforce availability, approved leave,
            working-hour limits, and rest requirements. Review before applying — nothing is
            written until you confirm.
          </ModalDescription>
        </ModalHeader>

        <div className="space-y-4">
          {!suggestion ? (
            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Branch <span className="text-red-500">*</span>
                  </label>
                  <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
                    <option value="">Select…</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Department (optional)</label>
                  <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
                    <option value="">All departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Start date <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    End date <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}

              <ModalFooter className="pt-2">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={generate.isPending} className="gap-2">
                  {generate.isPending ? 'Building your suggested schedule…' : 'Generate suggestions'}
                </Button>
              </ModalFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric label="Shifts considered" value={String(suggestion.shiftsConsidered)} />
                <Metric label="Suggested" value={String(suggestion.suggestedCount)} />
                <Metric label="Unfilled" value={String(suggestion.unfilledShifts.length)} />
                <Metric label="Hard conflicts dropped" value={String(suggestion.droppedBlocking)} />
              </div>

              {suggestion.suggestedCount === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                  No suggestions were produced. Adjust the range or check employee availability and approved leave.
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-slate-700">Proposed assignments</p>
                  {Array.from(
                    suggestion.assignments.reduce((map, a) => {
                      const list = map.get(a.shiftId) ?? [];
                      list.push(a);
                      map.set(a.shiftId, list);
                      return map;
                    }, new Map<string, SuggestedAssignment[]>()),
                  ).map(([shiftId, list]) => (
                    <div key={shiftId} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 bg-slate-50/50">
                      <span className="text-sm font-semibold text-slate-800">{shiftName(shiftId)}</span>
                      <div className="flex flex-wrap gap-1">
                        {list.map((a) => (
                          <span key={a.employeeId} className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark">
                            {employeeName(a.employeeId)}
                            {a.warnings.length > 0 && (
                              <span className="font-bold text-amber-600" title={a.warnings.map((w) => w.message).join('; ')}>
                                !
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {applyMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                  {applyMsg}
                </div>
              )}
              {apply.isError && error && (
                <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}

              <ModalFooter className="pt-2">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={() => setSuggestion(null)}>
                  Regenerate
                </Button>
                <Button
                  onClick={() => apply.mutate()}
                  disabled={apply.isPending || suggestion.suggestedCount === 0}
                >
                  {apply.isPending ? 'Applying…' : 'Apply suggestions'}
                </Button>
              </ModalFooter>
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-3 py-2">
      <p className="text-2xl font-bold text-slate-900 font-sans">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </Card>
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
    <Card className="shift-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-800">{shift.name}</p>
            <StatusBadge status={shift.status} />
          </div>
          <p className="text-sm text-slate-500 font-mono">
            {formatTime(shift.startAt)} – {formatTime(shift.endAt)}
            {shift.branch ? ` · ${shift.branch.name}` : ''}
            {deptName ? ` · ${deptName}` : ''}
          </p>
          {shift.assignments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {shift.assignments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark"
                >
                  {a.employee.firstName} {a.employee.lastName}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAssigning((v) => !v)}>
            {assigning ? 'Cancel' : 'Assign'}
          </Button>
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
              <Button
                onClick={() => employeeId && assign.mutate()}
                disabled={!employeeId || assign.isPending}
                size="sm"
              >
                {assign.isPending ? '…' : 'Assign'}
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      {(result?.message || result?.conflicts || result?.warnings) && (
        <div className="border-t border-slate-100 px-4 py-3">
          {result?.message && <p className="text-sm font-semibold text-red-600">{result.message}</p>}
          {result?.conflicts?.map((c) => (
            <p key={c.ruleIdentifier + c.message} className="text-xs text-red-600">
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

function cn(...inputs: (string | false | undefined | null)[]): string {
  return inputs.filter(Boolean).join(' ');
}
