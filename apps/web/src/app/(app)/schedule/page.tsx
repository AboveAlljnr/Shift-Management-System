'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  AlignJustify,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LayoutGrid,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
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
  createSchedule,
  createShift,
  fetchBranches,
  fetchCertifications,
  fetchCoverage,
  fetchDepartments,
  fetchEmployees,
  fetchScheduleVersions,
  fetchSchedules,
  fetchShifts,
  fetchSkills,
  generateScheduleSuggestions,
  listOpenShiftRequests,
  listSwapRequests,
  publishSchedule,
  reviewOpenShiftRequest,
  reviewSwap,
  setShiftOpen,
  updateShiftRequirements,
  type CertificationCatalogItem,
  type OpenShiftRequestRow,
  type ScheduleDetail,
  type ScheduleExplanation,
  type ScheduleSuggestion,
  type ScheduleVersion,
  type ShiftDetail,
  type ShiftRequirementInput,
  type SkillCatalogItem,
  type SuggestedAssignment,
  type SwapRequestRow,
} from '@/lib/api/queries';
import { getAuthUser, hasRole } from '@/lib/auth';
import { formatTime, getInitials } from '@/lib/utils';
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

const EXCLUSION_LABELS: Record<string, string> = {
  APPROVED_LEAVE: 'Approved leave',
  UNAVAILABLE: 'Unavailable',
  SHIFT_OVERLAP: 'Shift overlap',
  MIN_REST: 'Minimum rest not met',
  WEEKLY_HOURS: 'Weekly hours exceeded',
  MISSING_SKILL: 'Missing required skill',
  MISSING_CERTIFICATION: 'Missing required certification',
  EXPIRED_CERTIFICATION: 'Certification expired',
  OUT_OF_SCOPE: 'Outside scope',
  NO_ELIGIBLE_EMPLOYEE: 'No eligible employee',
};

export default function SchedulePage() {
  const queryClient = useQueryClient();
  const canReview = hasRole(getAuthUser(), ['admin', 'manager', 'shift_manager']);

  const { data: shifts, isLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => fetchShifts(),
    staleTime: 30 * 1000,
  });

  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => fetchEmployees({ limit: 100 }) });
  const { data: skillCatalog = [] } = useQuery({ queryKey: ['skills'], queryFn: fetchSkills });
  const { data: certCatalog = [] } = useQuery({ queryKey: ['certifications'], queryFn: fetchCertifications });

  const [showCreate, setShowCreate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [showOpenRequests, setShowOpenRequests] = useState(false);
  const [showSwapRequests, setShowSwapRequests] = useState(false);
  const [view, setView] = useState<'week' | 'day'>('week');
  const [weekStart, setWeekStart] = useState(() => toISODate(startOfWeek(new Date())));
  const [deptFilter, setDeptFilter] = useState('all');
  const [form, setForm] = useState({
    name: '',
    branchId: '',
    departmentId: '',
    startAt: '',
    endAt: '',
    notes: '',
    requirements: [{ headcount: '1', skillIds: [] as string[], certificationIds: [] as string[] }],
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
        requirements: form.requirements.map((r) => ({
          headcount: parseInt(r.headcount, 10) || 1,
          skillIds: r.skillIds,
          certificationIds: r.certificationIds,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowCreate(false);
      setForm({ name: '', branchId: '', departmentId: '', startAt: '', endAt: '', notes: '', requirements: [{ headcount: '1', skillIds: [], certificationIds: [] }] });
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
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-sans">Schedule</h1>
            <p className="text-sm text-slate-500 mt-0.5">{(shifts ?? []).length} shifts · create, assign, and track</p>
          </div>
          <div className="hidden md:flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setView('week')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                view === 'week' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setView('day')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                view === 'day' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Day
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'week' && (
            <div className="flex items-center gap-1 border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setWeekStart((w) => toISODate(addDays(parseLocalDate(w), -7)))}
                aria-label="Previous week"
                className="p-2 hover:bg-slate-50 cursor-pointer"
              >
                <ChevronLeft size={16} className="text-slate-500" />
              </button>
              <span className="px-4 text-sm font-semibold text-slate-700 border-x border-slate-200 whitespace-nowrap">
                {format(parseLocalDate(weekStart), 'MMM d')} –{' '}
                {format(addDays(parseLocalDate(weekStart), 6), 'MMM d, yyyy')}
              </span>
              <button
                onClick={() => setWeekStart(toISODate(startOfWeek(new Date())))}
                className="px-3 py-2 text-xs font-semibold text-brand hover:bg-brand-light cursor-pointer"
              >
                Today
              </button>
              <button
                onClick={() => setWeekStart((w) => toISODate(addDays(parseLocalDate(w), 7)))}
                aria-label="Next week"
                className="p-2 hover:bg-slate-50 cursor-pointer"
              >
                <ChevronRight size={16} className="text-slate-500" />
              </button>
            </div>
          )}
          {view === 'week' && departments?.length ? (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 cursor-pointer focus:outline-none"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setShowSchedules(true)} className="gap-2">
            <Calendar size={14} className="text-brand" />
            Schedules
          </Button>
          <button
            onClick={() => setShowGenerate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-brand/90 text-white text-sm font-semibold rounded-lg hover:from-violet-700 hover:to-brand transition cursor-pointer"
          >
            <Sparkles size={14} /> AI Generate
          </button>
          {canReview && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setShowOpenRequests(true)} className="gap-2">
                <Inbox size={14} className="text-brand" />
                Open shift requests
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowSwapRequests(true)} className="gap-2">
                <RefreshCw size={14} className="text-brand" />
                Swap requests
              </Button>
            </>
          )}
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)} className="gap-2">
            <Plus size={14} />
            Add Shift
          </Button>
        </div>
      </div>

      {view === 'week' ? (
        <WeekGrid
          weekStart={weekStart}
          employees={employees?.data ?? []}
          shifts={shifts ?? []}
          departmentFilter={deptFilter}
        />
      ) : isLoading ? (
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
                    skillCatalog={skillCatalog}
                    certCatalog={certCatalog}
                    canReview={canReview}
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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Coverage requirements</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      requirements: [...f.requirements, { headcount: '1', skillIds: [], certificationIds: [] }],
                    }))
                  }
                >
                  + Add requirement
                </Button>
              </div>
              {form.requirements.map((req, idx) => (
                <RequirementEditor
                  key={idx}
                  index={idx}
                  req={req}
                  skillCatalog={skillCatalog}
                  certCatalog={certCatalog}
                  onChange={(next) =>
                    setForm((f) => {
                      const requirements = f.requirements.map((r, i) => (i === idx ? next : r));
                      return { ...f, requirements };
                    })
                  }
                  onRemove={() =>
                    setForm((f) => ({
                      ...f,
                      requirements: f.requirements.filter((_, i) => i !== idx),
                    }))
                  }
                />
              ))}
              {form.requirements.length > 0 && (
                <p className="text-xs text-slate-400">
                  Requirements gate eligibility: only employees holding the selected skills or
                  certifications can be assigned or request this shift.
                </p>
              )}
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

      {showSchedules && (
        <ScheduleManagerDialog
          branches={branches ?? []}
          onClose={() => setShowSchedules(false)}
        />
      )}

      {showOpenRequests && (
        <OpenShiftRequestsDialog onClose={() => setShowOpenRequests(false)} />
      )}

      {showSwapRequests && (
        <SwapRequestsDialog onClose={() => setShowSwapRequests(false)} />
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

              {suggestion.explanation && (
                <WhyThisSchedule explanation={suggestion.explanation} />
              )}

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

function WhyThisSchedule({ explanation }: { explanation: ScheduleExplanation }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3">
      <p className="text-sm font-bold text-slate-700">Why this schedule?</p>
      <p className="mt-0.5 text-xs text-slate-500">
        The optimizer considered {explanation.employeesConsidered} employee
        {explanation.employeesConsidered === 1 ? '' : 's'} and excluded {
          explanation.employeesExcluded
        }{' '}
        for the shifts below. Coverage reflects {explanation.proposedAssignments} proposed
        assignment{explanation.proposedAssignments === 1 ? '' : 's'} (
        {explanation.fullyCoveredShifts} fully covered, {explanation.partiallyCoveredShifts} partially
        covered, {explanation.unfilledShifts} unfilled).
      </p>
      {explanation.exclusionReasons.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {explanation.exclusionReasons.map((r) => (
            <Badge key={r.code} variant="neutral" className="gap-1">
              {EXCLUSION_LABELS[r.code] ?? r.code}
              <span className="font-bold text-slate-700">×{r.count}</span>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">No exclusions — everyone eligible was considered.</p>
      )}
    </div>
  );
}

function RequirementEditor({
  index,
  req,
  skillCatalog,
  certCatalog,
  onChange,
  onRemove,
}: {
  index: number;
  req: { headcount: string; skillIds: string[]; certificationIds: string[] };
  skillCatalog: SkillCatalogItem[];
  certCatalog: CertificationCatalogItem[];
  onChange: (next: { headcount: string; skillIds: string[]; certificationIds: string[] }) => void;
  onRemove: () => void;
}) {
  const toggle = (key: 'skillIds' | 'certificationIds', id: string) => {
    const current = req[key];
    onChange({
      ...req,
      [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-500">Requirement {index + 1}</label>
        {index > 0 && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs font-medium text-red-600 hover:underline"
          >
            Remove
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500">Headcount</label>
        <input
          type="number"
          min={1}
          value={req.headcount}
          onChange={(e) => onChange({ ...req, headcount: e.target.value })}
          className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
        />
      </div>
      <div className="mt-2">
        <p className="mb-1 text-xs font-semibold text-slate-500">Required skills</p>
        <div className="flex flex-wrap gap-1.5">
          {skillCatalog.filter((s) => s.isActive).map((s) => {
            const selected = req.skillIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle('skillIds', s.id)}
                className={
                  selected
                    ? 'rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white transition'
                    : 'rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/50'
                }
              >
                {s.name}
              </button>
            );
          })}
          {skillCatalog.filter((s) => s.isActive).length === 0 && (
            <span className="text-xs text-slate-400">No skills in the catalog.</span>
          )}
        </div>
      </div>
      <div className="mt-2">
        <p className="mb-1 text-xs font-semibold text-slate-500">Required certifications</p>
        <div className="flex flex-wrap gap-1.5">
          {certCatalog.filter((c) => c.isActive).map((c) => {
            const selected = req.certificationIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle('certificationIds', c.id)}
                className={
                  selected
                    ? 'rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white transition'
                    : 'rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/50'
                }
              >
                {c.name}
              </button>
            );
          })}
          {certCatalog.filter((c) => c.isActive).length === 0 && (
            <span className="text-xs text-slate-400">No certifications in the catalog.</span>
          )}
        </div>
      </div>
    </div>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ScheduleManagerDialog({
  branches,
  onClose,
}: {
  branches: BranchOption[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: schedules, isLoading } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => fetchSchedules(),
  });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showVersionsFor, setShowVersionsFor] = useState<ScheduleDetail | null>(null);
  const [publishFor, setPublishFor] = useState<ScheduleDetail | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', branchId: '', periodStart: '', periodEnd: '' });

  const create = useMutation({
    mutationFn: () =>
      createSchedule({
        name: form.name,
        branchId: form.branchId || undefined,
        periodStart: new Date(form.periodStart).toISOString(),
        periodEnd: new Date(form.periodEnd).toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setShowCreateForm(false);
      setForm({ name: '', branchId: '', periodStart: '', periodEnd: '' });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Unable to create schedule'),
  });

  const publish = useMutation({
    mutationFn: () => publishSchedule(publishFor!.id, { notes: notes || undefined }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setPublishFor(null);
      setNotes('');
      setError(`Published as version ${res.versionNumber}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Unable to publish schedule'),
  });

  const branchName = (id?: string | null) => branches.find((b) => b.id === id)?.name ?? 'Company-wide';

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>Schedules &amp; publish</ModalTitle>
          <ModalDescription>
            Group shifts into periods, publish them to teams, and keep an immutable version history.
          </ModalDescription>
        </ModalHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              {error}
            </div>
          )}

          {showVersionsFor ? (
            <VersionsPanel schedule={showVersionsFor} onBack={() => setShowVersionsFor(null)} />
          ) : showCreateForm ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                if (!form.name.trim()) return setError('Schedule name is required');
                if (!form.periodStart || !form.periodEnd) return setError('Period dates are required');
                if (new Date(form.periodEnd) < new Date(form.periodStart)) return setError('End date must be on or after start date');
                create.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Schedule name <span className="text-red-500">*</span>
                </label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Week 37 roster" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Branch (optional)</label>
                  <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className={inputClass}>
                    <option value="">Company-wide</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Period start <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Period end <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} className={inputClass} />
                </div>
              </div>

              {create.isError && error && (
                <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</div>
              )}

              <ModalFooter className="pt-2">
                <Button variant="secondary" onClick={() => { setShowCreateForm(false); setError(null); }}>Cancel</Button>
                <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Create schedule'}</Button>
              </ModalFooter>
            </form>
          ) : (
            <>
              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={() => setShowCreateForm(true)} className="gap-2">
                  <Plus size={14} /> New schedule
                </Button>
              </div>

              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-200/60" />
                  ))}
                </div>
              ) : (schedules ?? []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                  <p className="font-semibold text-slate-700">No schedules yet</p>
                  <p className="text-sm text-slate-500">Create a schedule to group shifts into a publishable period.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(schedules ?? []).map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-800">{s.name}</p>
                          <StatusBadge status={s.status} />
                        </div>
                        <p className="text-xs text-slate-500">
                          {format(parseISO(s.periodStart), 'MMM d')} – {format(parseISO(s.periodEnd), 'MMM d, yyyy')}
                          {' · '}{branchName(s.branchId)}
                          {' · '}{s._count.shifts} shifts
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setShowVersionsFor(s)}>
                          {s._count.versions} version{s._count.versions === 1 ? '' : 's'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setPublishFor(s)} disabled={s.status === 'locked'}>
                          Publish
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <ModalFooter className="pt-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </ModalFooter>

        {publishFor && (
          <PublishConfirmDialog
            schedule={publishFor}
            onCancel={() => setPublishFor(null)}
            onConfirm={() => publish.mutate()}
            notes={notes}
            setNotes={setNotes}
            pending={publish.isPending}
          />
        )}
      </ModalContent>
    </Modal>
  );
}

function PublishConfirmDialog({
  schedule,
  onCancel,
  onConfirm,
  notes,
  setNotes,
  pending,
}: {
  schedule: ScheduleDetail;
  onCancel: () => void;
  onConfirm: () => void;
  notes: string;
  setNotes: (v: string) => void;
  pending: boolean;
}) {
  return (
    <Modal open onOpenChange={(o) => !o && onCancel()}>
      <ModalContent className="max-w-md">
        <ModalHeader>
          <ModalTitle>Publish &quot;{schedule.name}&quot;</ModalTitle>
          <ModalDescription>
            Publishing creates an immutable version snapshot and pushes {schedule._count.shifts} shift(s) to your team.
            Once published the schedule status becomes &quot;published&quot;.
          </ModalDescription>
        </ModalHeader>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Publish notes (optional)</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Final roster for week 37" />
        </div>
        <ModalFooter className="pt-4">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} disabled={pending}>{pending ? 'Publishing…' : 'Publish schedule'}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function VersionsPanel({
  schedule,
  onBack,
}: {
  schedule: ScheduleDetail;
  onBack: () => void;
}) {
  const { data: versions, isLoading } = useQuery({
    queryKey: ['scheduleVersions', schedule.id],
    queryFn: () => fetchScheduleVersions(schedule.id),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-800">Version history — {schedule.name}</p>
          <p className="text-xs text-slate-500">Immutable snapshots, newest first</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onBack}>Back</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-200/60" />
          ))}
        </div>
      ) : (versions ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No published versions yet. Publish this schedule to create the first snapshot.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {(versions ?? []).map((v) => (
            <VersionItem key={v.id} version={v} />
          ))}
        </ol>
      )}
    </div>
  );
}

function VersionItem({ version }: { version: ScheduleVersion }) {
  return (
    <li className="relative">
      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-brand-light" />
      <div className="rounded-xl border border-slate-200 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-800">v{version.versionNumber}</p>
          <p className="text-xs text-slate-500">{format(parseISO(version.publishedAt), 'MMM d, yyyy · h:mm a')}</p>
        </div>
        <p className="text-xs text-slate-500">
          Published by {version.publishedBy?.name ?? version.publishedBy?.email ?? 'Unknown'}
        </p>
        {version.notes && <p className="mt-1 text-sm text-slate-600">{version.notes}</p>}
      </div>
    </li>
  );
}

interface BranchOption {
  id: string;
  name: string;
}

function ShiftCard({
  shift,
  employees,
  departments,
  skillCatalog,
  certCatalog,
  canReview,
}: {
  shift: ShiftDetail;
  employees: { id: string; firstName: string; lastName: string }[];
  departments: { id: string; name: string }[];
  skillCatalog: SkillCatalogItem[];
  certCatalog: CertificationCatalogItem[];
  canReview: boolean;
}) {
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<{ message?: string; conflicts?: ConflictItem[]; warnings?: ConflictItem[] } | null>(null);
  const [showEditRequirements, setShowEditRequirements] = useState(false);
  const [openNotice, setOpenNotice] = useState<string | null>(null);

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

  const toggleOpen = useMutation({
    mutationFn: () => setShiftOpen(shift.id, !shift.isOpen),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setOpenNotice(
        res.isOpen
          ? `Shift opened — notified ${res.notifiedEmployees} eligible employee${res.notifiedEmployees === 1 ? '' : 's'}.`
          : 'Shift closed to new requests.',
      );
    },
    onError: (e) => setOpenNotice(e instanceof Error ? e.message : 'Unable to update shift'),
  });

  const deptName = departments.find((d) => d.id === shift.departmentId)?.name;
  const totalRequired = shift.requirements.reduce((sum, r) => sum + r.headcount, 0);

  return (
    <Card className="shift-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-800">{shift.name}</p>
            <StatusBadge status={shift.status} />
            {shift.isOpen && canReview && (
              <Badge variant="brand">Open for requests</Badge>
            )}
          </div>
          <p className="text-sm text-slate-500 font-mono">
            {formatTime(shift.startAt)} – {formatTime(shift.endAt)}
            {shift.branch ? ` · ${shift.branch.name}` : ''}
            {deptName ? ` · ${deptName}` : ''}
          </p>
          {shift.requirements.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="draft">Needs {totalRequired}</Badge>
              {shift.requirements.flatMap((r) => r.skills ?? []).map((s) => (
                <Badge key={`skill-${s.skill.id}`} variant="info">
                  {s.skill.name}
                </Badge>
              ))}
              {shift.requirements.flatMap((r) => r.certifications ?? []).map((c) => (
                <Badge key={`cert-${c.certification.id}`} variant="warning">
                  {c.certification.name}
                </Badge>
              ))}
            </div>
          )}
          {shift.coverage && shift.coverage.headcountRequired > 0 && (
            <p className="mt-1 flex items-center gap-2 text-xs">
              <CoverageBadge coverage={shift.coverage} />
            </p>
          )}
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
          {openNotice && (
            <p className="mt-1 text-xs text-slate-500">{openNotice}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {canReview && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toggleOpen.mutate()}
                disabled={toggleOpen.isPending}
              >
                {shift.isOpen ? 'Close to requests' : 'Open to requests'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowEditRequirements(true)}>
                Requirements
              </Button>
            </div>
          )}
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

      {showEditRequirements && (
        <ShiftRequirementsDialog
          shift={shift}
          skillCatalog={skillCatalog}
          certCatalog={certCatalog}
          onClose={() => setShowEditRequirements(false)}
        />
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

// ── Week grid helpers ─────────────────────────────────────────────────────────

function parseLocalDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
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

const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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

interface WeekGridRowEmployee {
  id: string;
  firstName: string;
  lastName: string;
  status?: string;
  team?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
}

function WeekGrid({
  weekStart,
  employees,
  shifts,
  departmentFilter,
}: {
  weekStart: string;
  employees: WeekGridRowEmployee[];
  shifts: ShiftDetail[];
  departmentFilter: string;
}) {
  const weekEnd = toISODate(addDays(parseLocalDate(weekStart), 7));
  const weekShifts = shifts.filter(
    (s) =>
      s.startAt.slice(0, 10) >= weekStart &&
      s.startAt.slice(0, 10) < weekEnd &&
      (departmentFilter === 'all' || s.departmentId === departmentFilter),
  );

  const { data: coverage = [] } = useQuery({
    queryKey: ['coverage', 'schedule-week', weekStart, weekEnd, departmentFilter],
    queryFn: () => fetchCoverage(weekShifts.map((s) => s.id)),
    enabled: weekShifts.length > 0,
    staleTime: 30 * 1000,
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(parseLocalDate(weekStart), i);
    return { label: WEEK_LABELS[i], date: d.getDate(), iso: toISODate(d) };
  });
  const todayISO = new Date().toISOString().slice(0, 10);

  const rows = (employees ?? []).filter((e) => !e.status || e.status === 'active');
  const shiftStatusClass = (status: string) => {
    if (status === 'published') return 'bg-green-50 border-green-200 text-green-800';
    if (status === 'cancelled') return 'bg-slate-100 border-slate-200 text-slate-500';
    return 'bg-slate-100 border-slate-200 text-slate-700';
  };
  const coverageByDay = days.map((day) => {
    const dayShifts = weekShifts.filter((s) => s.startAt.slice(0, 10) === day.iso);
    let required = 0;
    let filled = 0;
    for (const s of dayShifts) {
      const c = coverage.find((x) => x.shiftId === s.id);
      if (c && c.headcountRequired > 0) {
        required += c.headcountRequired;
        filled += c.headcountFilled;
      } else {
        required += s.requirements.reduce((sum, r) => sum + r.headcount, 0);
        filled += s.assignments.length;
      }
    }
    return { ...day, required, filled, dayShifts };
  });

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-4">
          {[
            ['Published', 'bg-green-50 border-green-200 text-green-700'],
            ['Draft', 'bg-slate-100 border-slate-200 text-slate-600'],
            ['Cancelled', 'bg-slate-100 border-slate-200 text-slate-500'],
          ].map(([label, cls]) => (
            <span key={label} className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${cls}`}>
              {label}
            </span>
          ))}
          <span className="text-xs text-slate-400 flex items-center gap-1.5 border-l border-slate-200 pl-4">
            <span className="w-2 h-2 rounded-sm bg-green-400 inline-block" />Full
            <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block ml-2" />Partial
            <span className="w-2 h-2 rounded-sm bg-red-400 inline-block ml-2" />Under
            <span className="font-medium text-slate-500 ml-1">= coverage</span>
          </span>
        </div>
        {weekShifts.length === 0 && (
          <span className="ml-auto text-xs text-slate-400">No shifts in the selected week.</span>
        )}
      </div>

      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full border-collapse" style={{ minWidth: 880 }}>
          <thead className="sticky top-0 z-10 bg-white shadow-sm">
            <tr>
              <th className="w-44 px-4 py-3 text-left border-r border-b border-border bg-slate-50">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Employee</span>
              </th>
              {days.map((d, i) => (
                <th
                  key={d.iso}
                  className={`px-3 py-3 border-b border-border text-center ${
                    d.iso === todayISO ? 'bg-brand-light border-x border-brand/20' : 'bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-bold text-slate-700">{d.label}</p>
                  <p className={`text-xs font-semibold mt-0.5 ${d.iso === todayISO ? 'text-brand' : 'text-slate-400'}`}>
                    {d.date}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((emp, ri) => (
              <tr key={emp.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                <td className="px-4 py-2.5 border-r border-b border-border w-44">
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      initials={getInitials(`${emp.firstName} ${emp.lastName}`)}
                      color={colorFor(`${emp.firstName} ${emp.lastName}`)}
                      size="sm"
                      className="w-7 h-7 text-[10px]"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">
                        {emp.firstName} {emp.lastName}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {emp.team?.name ?? emp.department?.name ?? '—'}
                      </p>
                    </div>
                  </div>
                </td>
                {days.map((d) => {
                  const cellShifts = weekShifts
                    .filter(
                      (s) =>
                        s.startAt.slice(0, 10) === d.iso &&
                        s.assignments.some((a) => a.employeeId === emp.id),
                    )
                    .sort((a, b) => a.startAt.localeCompare(b.startAt));
                  return (
                    <td
                      key={d.iso}
                      className={`px-2 py-2 border-b border-border align-top transition-colors ${
                        d.iso === todayISO ? 'bg-brand-light/60 border-x border-brand/10' : ''
                      }`}
                    >
                      <div className="space-y-1 min-h-[52px]">
                        {cellShifts.map((s) => (
                          <div
                            key={s.id}
                            className={`px-2 py-1 rounded-md border text-[11px] select-none ${shiftStatusClass(s.status)}`}
                          >
                            <div className="font-bold">
                              {formatTime(s.startAt)} – {formatTime(s.endAt)}
                            </div>
                            <div className="opacity-70 truncate mt-0.5">{s.name}</div>
                          </div>
                        ))}
                        {cellShifts.length === 0 && (
                          <div className="w-full h-10 rounded-lg border border-dashed border-slate-200 text-slate-300 flex items-center justify-center text-lg">
                            +
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Coverage heatmap row */}
            <tr className="sticky bottom-0 bg-white border-t-2 border-border z-10">
              <td className="px-4 py-3 border-r border-border">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Coverage</p>
              </td>
              {coverageByDay.map((d) => {
                const pct = d.required > 0 ? d.filled / d.required : 1;
                const color = pct >= 1 ? '#16A34A' : pct >= 0.6 ? '#D97706' : '#DC2626';
                const bgLight = pct >= 1 ? 'bg-green-50' : pct >= 0.6 ? 'bg-amber-50' : 'bg-red-50';
                const label = pct >= 1 ? 'Full' : pct >= 0.6 ? 'Partial' : 'Under';
                return (
                  <td key={d.iso} className={`px-2 py-3 text-center ${d.iso === todayISO ? 'border-x border-brand/10' : ''}`}>
                    <div className={`rounded-lg px-2 py-2 ${bgLight}`}>
                      <p className="text-sm font-bold" style={{ color }}>
                        {d.filled}/{d.required || '—'}
                      </p>
                      <div className="mt-1.5 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct * 100}%`, background: color }}
                        />
                      </div>
                      <p className="text-[9px] font-semibold mt-1" style={{ color }}>
                        {d.required > 0 ? label : 'none'}
                      </p>
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CoverageBadge({ coverage }: { coverage: NonNullable<ShiftDetail['coverage']> }) {
  if (coverage.covered) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        {coverage.headcountFilled}/{coverage.headcountRequired} staffed
        {coverage.overstaffed && ' · overstaffed'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
      Understaffed · {coverage.headcountFilled}/{coverage.headcountRequired} (need {coverage.shortfall} more)
    </span>
  );
}

function cn(...inputs: (string | false | undefined | null)[]): string {
  return inputs.filter(Boolean).join(' ');
}

function ShiftRequirementsDialog({
  shift,
  skillCatalog,
  certCatalog,
  onClose,
}: {
  shift: ShiftDetail;
  skillCatalog: SkillCatalogItem[];
  certCatalog: CertificationCatalogItem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<
    { headcount: string; skillIds: string[]; certificationIds: string[] }[]
  >(
    () =>
      shift.requirements.length > 0
        ? shift.requirements.map((r) => ({
            headcount: String(r.headcount),
            skillIds: (r.skills ?? []).map((s) => s.skill.id),
            certificationIds: (r.certifications ?? []).map((c) => c.certification.id),
          }))
        : [{ headcount: '1', skillIds: [], certificationIds: [] }],
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      updateShiftRequirements(
        shift.id,
        rows.map((r): ShiftRequirementInput => ({
          headcount: parseInt(r.headcount, 10) || 1,
          skillIds: r.skillIds,
          certificationIds: r.certificationIds,
        })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setNotice('Requirements updated.');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Unable to update requirements'),
  });

  const activeSkills = skillCatalog.filter((s) => s.isActive);
  const activeCerts = certCatalog.filter((c) => c.isActive);

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-xl">
        <ModalHeader>
          <ModalTitle>Requirements — {shift.name}</ModalTitle>
          <ModalDescription>
            Set headcount and required skills/certifications. Eligibility for assignment and open-shift
            requests is derived from these.
          </ModalDescription>
        </ModalHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {rows.map((row, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500">Requirement {idx + 1}</label>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs text-slate-500">Headcount</label>
                <input
                  type="number"
                  min={1}
                  value={row.headcount}
                  onChange={(e) =>
                    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, headcount: e.target.value } : r)))
                  }
                  className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </div>
              <div className="mt-2">
                <p className="mb-1 text-xs font-semibold text-slate-500">Required skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeSkills.map((s) => {
                    const selected = row.skillIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          setRows((rs) =>
                            rs.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    skillIds: selected
                                      ? r.skillIds.filter((x) => x !== s.id)
                                      : [...r.skillIds, s.id],
                                  }
                                : r,
                            ),
                          )
                        }
                        className={
                          selected
                            ? 'rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white transition'
                            : 'rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/50'
                        }
                      >
                        {s.name}
                      </button>
                    );
                  })}
                  {activeSkills.length === 0 && (
                    <span className="text-xs text-slate-400">No skills in the catalog.</span>
                  )}
                </div>
              </div>
              <div className="mt-2">
                <p className="mb-1 text-xs font-semibold text-slate-500">Required certifications</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeCerts.map((c) => {
                    const selected = row.certificationIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setRows((rs) =>
                            rs.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    certificationIds: selected
                                      ? r.certificationIds.filter((x) => x !== c.id)
                                      : [...r.certificationIds, c.id],
                                  }
                                : r,
                            ),
                          )
                        }
                        className={
                          selected
                            ? 'rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white transition'
                            : 'rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/50'
                        }
                      >
                        {c.name}
                      </button>
                    );
                  })}
                  {activeCerts.length === 0 && (
                    <span className="text-xs text-slate-400">No certifications in the catalog.</span>
                  )}
                </div>
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { headcount: '1', skillIds: [], certificationIds: [] }])}>
            + Add requirement
          </Button>
        </div>

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
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </ModalClose>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save requirements'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function OpenShiftRequestsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data: requests, isLoading } = useQuery({
    queryKey: ['shifts-open-requests'],
    queryFn: listOpenShiftRequests,
    refetchInterval: 15 * 1000,
  });

  const review = useMutation({
    mutationFn: ({
      requestId,
      action,
    }: {
      requestId: string;
      action: 'approve' | 'reject';
    }) => reviewOpenShiftRequest(requestId, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts-open-requests'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ['shifts-open-requests'] });
      setError(e instanceof Error ? e.message : 'Unable to review request');
    },
  });

  const [error, setError] = useState<string | null>(null);
  const pending = (requests ?? []).filter((r) => r.status === 'pending');

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>Open shift requests</ModalTitle>
          <ModalDescription>
            Employees who requested an open shift. Approve to assign them (eligibility is
            re-validated), or reject.
          </ModalDescription>
        </ModalHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-200/60" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <p className="text-sm text-slate-500">No pending open-shift requests.</p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {r.employee.firstName} {r.employee.lastName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.shift.name} · {format(parseISO(r.shift.startAt), 'MMM d, h:mm a')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => review.mutate({ requestId: r.id, action: 'reject' })}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => review.mutate({ requestId: r.id, action: 'approve' })}>
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <ModalFooter className="pt-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function SwapRequestsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data: requests, isLoading } = useQuery({
    queryKey: ['shifts-swap-requests'],
    queryFn: listSwapRequests,
    refetchInterval: 15 * 1000,
  });

  const [error, setError] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: 'approve' | 'reject' }) =>
      reviewSwap(requestId, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts-swap-requests'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (e) => {
      queryClient.invalidateQueries({ queryKey: ['shifts-swap-requests'] });
      setError(e instanceof Error ? e.message : 'Unable to review swap');
    },
  });

  const active = (requests ?? []).filter((r) => r.status === 'pending' || r.status === 'accepted');

  return (
    <Modal open onOpenChange={(o) => !o && onClose()}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>Shift swap requests</ModalTitle>
          <ModalDescription>
            Accepted swaps are ready for your approval. Pending swaps are still awaiting the target
            employee&apos;s response.
          </ModalDescription>
        </ModalHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-200/60" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <p className="text-sm text-slate-500">No swap requests requiring attention.</p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {active.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {r.requestingEmployee.firstName} {r.requestingEmployee.lastName} →{' '}
                    {r.targetEmployee ? `${r.targetEmployee.firstName} ${r.targetEmployee.lastName}` : 'Any colleague'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.shift.name} · {format(parseISO(r.shift.startAt), 'MMM d, h:mm a')} ·{' '}
                    {r.status === 'accepted' ? 'Accepted — awaiting approval' : 'Pending target response'}
                  </p>
                  {r.reason && <p className="text-xs text-slate-400">“{r.reason}”</p>}
                </div>
                {r.status === 'accepted' && (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => review.mutate({ requestId: r.id, action: 'reject' })}>
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => review.mutate({ requestId: r.id, action: 'approve' })}>
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <ModalFooter className="pt-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
