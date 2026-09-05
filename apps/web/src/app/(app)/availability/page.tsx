'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
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
  createAvailabilityException,
  createAvailabilityRule,
  deleteAvailabilityException,
  deleteAvailabilityRule,
  fetchAvailabilityExceptions,
  fetchAvailabilityRules,
  fetchEmployees,
  fetchMyEmployee,
  updateAvailabilityException,
  updateAvailabilityRule,
  type AvailabilityExceptionDetail,
  type AvailabilityRuleDetail,
} from '@/lib/api/queries';
import { getAuthUser } from '@/lib/auth';
import { format, parseISO } from 'date-fns';

const inputClass =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first, mapping to dayOfWeek (0=Sunday)

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AvailabilityPage() {
  const queryClient = useQueryClient();
  const user = getAuthUser();
  const isManager = useMemo(() => {
    if (!user) return false;
    const roles = user.roles.map((r) => r.toLowerCase());
    return roles.some((r) => ['owner', 'admin', 'manager'].includes(r));
  }, [user]);

  const { data: me } = useQuery({ queryKey: ['myEmployee'], queryFn: fetchMyEmployee });
  const myEmployeeId = me?.id;

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchEmployees({ limit: 100 }),
    enabled: isManager,
  });

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const effectiveEmployeeId = isManager
    ? (selectedEmployeeId || undefined)
    : (myEmployeeId || undefined);

  const rules = useQuery({
    queryKey: ['availability', 'rules', effectiveEmployeeId ?? 'all'],
    queryFn: () => fetchAvailabilityRules(effectiveEmployeeId ? { employeeId: effectiveEmployeeId } : undefined),
    enabled: !!myEmployeeId || isManager,
  });

  const exceptions = useQuery({
    queryKey: ['availability', 'exceptions', effectiveEmployeeId ?? 'all'],
    queryFn: () => fetchAvailabilityExceptions(effectiveEmployeeId ? { employeeId: effectiveEmployeeId } : undefined),
    enabled: !!myEmployeeId || isManager,
  });

  const [showRule, setShowRule] = useState(false);
  const [editingRule, setEditingRule] = useState<AvailabilityRuleDetail | null>(null);
  const [ruleForm, setRuleForm] = useState({
    employeeId: '',
    dayOfWeek: '1',
    startTime: '09:00',
    endTime: '17:00',
    isAvailable: 'true',
    effectiveFrom: '',
  });

  const [showException, setShowException] = useState(false);
  const [exceptionForm, setExceptionForm] = useState({
    employeeId: '',
    date: '',
    reason: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const saveRule = useMutation({
    mutationFn: () => {
      const employeeId = ruleForm.employeeId || myEmployeeId as string;
      const payload = {
        employeeId,
        dayOfWeek: Number(ruleForm.dayOfWeek),
        startTime: ruleForm.startTime,
        endTime: ruleForm.endTime,
        isAvailable: ruleForm.isAvailable === 'true',
        effectiveFrom: new Date(ruleForm.effectiveFrom + 'T00:00:00').toISOString(),
        effectiveTo: null,
      };
      return editingRule
        ? updateAvailabilityRule(editingRule.id, {
            dayOfWeek: Number(ruleForm.dayOfWeek),
            startTime: ruleForm.startTime,
            endTime: ruleForm.endTime,
            isAvailable: ruleForm.isAvailable === 'true',
          })
        : createAvailabilityRule(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability', 'rules'] });
      setShowRule(false);
      setEditingRule(null);
      setFormError(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Unable to save availability rule'),
  });

  const saveException = useMutation({
    mutationFn: () => {
      const employeeId = exceptionForm.employeeId || myEmployeeId as string;
      return createAvailabilityException({
        employeeId,
        date: new Date(exceptionForm.date + 'T00:00:00').toISOString(),
        reason: exceptionForm.reason || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability', 'exceptions'] });
      setShowException(false);
      setFormError(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Unable to add exception'),
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => deleteAvailabilityRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['availability', 'rules'] }),
  });
  const deleteException = useMutation({
    mutationFn: (id: string) => deleteAvailabilityException(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['availability', 'exceptions'] }),
  });

  const employeeName = (id: string) => {
    const e = employees?.data.find((x) => x.id === id);
    if (e) return `${e.firstName} ${e.lastName}`;
    return id === myEmployeeId ? 'You' : 'Unknown';
  };

  function openCreateRule() {
    setEditingRule(null);
    setRuleForm({
      employeeId: (isManager && selectedEmployeeId) || '',
      dayOfWeek: '1',
      startTime: '09:00',
      endTime: '17:00',
      isAvailable: 'true',
      effectiveFrom: new Date().toISOString().slice(0, 10),
    });
    setFormError(null);
    setShowRule(true);
  }

  function handleRuleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const start = Number(ruleForm.startTime.replace(':', ''));
    const end = Number(ruleForm.endTime.replace(':', ''));
    if (!editingRule && !ruleForm.employeeId && !myEmployeeId) return setFormError('Select an employee');
    if (ruleForm.isAvailable === 'true' && start >= end) {
      return setFormError('Start time must be before end time for an available window');
    }
    if (!ruleForm.effectiveFrom) return setFormError('Effective from date is required');
    saveRule.mutate();
  }

  function handleExceptionSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!exceptionForm.date) return setFormError('Date is required');
    if (!exceptionForm.employeeId && !myEmployeeId) return setFormError('Select an employee');
    saveException.mutate();
  }

  const ruleList = (rules.data ?? []) as AvailabilityRuleDetail[];
  const exceptionList = (exceptions.data ?? []) as AvailabilityExceptionDetail[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Availability"
          subtitle={isManager ? 'Team availability rules and exceptions' : 'Your availability'}
        />
        <div className="flex items-center gap-2">
          {isManager && (
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className={inputClass + ' min-w-44'}
            >
              <option value="">All employees</option>
              {(employees?.data ?? []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" size="sm" onClick={() => setShowException(true)} className="gap-2" disabled={!!effectiveEmployeeId === false && !isManager}>
            + Exception
          </Button>
          <Button variant="primary" size="sm" onClick={openCreateRule} className="gap-2">
            <Plus size={14} /> New rule
          </Button>
        </div>
      </div>

      {formError && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {formError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">This week</CardTitle>
          <CardDescription>
            {isManager && !effectiveEmployeeId
              ? 'Availability coverage across all employees'
              : `${employeeName(effectiveEmployeeId ?? '')} — repeats every week`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.isLoading ? (
            <div className="grid gap-2 sm:grid-cols-7">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200/60" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {WEEK_ORDER.map((dow) => {
                const dayRules = ruleList.filter((r) => r.dayOfWeek === dow);
                const available = dayRules.filter((r) => r.isAvailable);
                const unavailable = dayRules.filter((r) => !r.isAvailable);
                const scopeRules = effectiveEmployeeId
                  ? dayRules.filter((r) => r.employeeId === effectiveEmployeeId)
                  : dayRules;

                const weekDate = new Date(startOfWeekMonday(new Date()));
                weekDate.setDate(weekDate.getDate() + WEEK_ORDER.indexOf(dow));
                const dateISO = toISODate(weekDate);
                const scopeExceptions = effectiveEmployeeId
                  ? exceptionList.filter((ex) => ex.employeeId === effectiveEmployeeId && ex.date.slice(0, 10) === dateISO)
                  : [];

                const employeeScope = !!effectiveEmployeeId;
                const hasRule = scopeRules.length > 0;
                const isAvailable = scopeRules.some((r) => r.isAvailable);
                const windowRule = [...scopeRules].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).find((r) => r.isAvailable) ?? scopeRules[0];
                const exceptionOverride = scopeExceptions[0];

                const label = DAY_NAMES[dow];
                const isToday = dateISO === toISODate(new Date());

                return (
                  <div
                    key={dow}
                    className={
                      'rounded-xl border p-3 ' +
                      (isToday
                        ? 'border-brand/40 bg-brand-light ring-1 ring-brand/30'
                        : exceptionOverride
                          ? exceptionOverride.isAvailable
                            ? 'border-emerald-200 bg-emerald-50'
                            : 'border-red-200 bg-red-50'
                          : employeeScope && isAvailable
                            ? 'border-emerald-200 bg-emerald-50/50'
                            : 'border-slate-200 bg-slate-50/60')
                    }
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {label}
                      {isToday && <span className="ml-1 text-brand">· Today</span>}
                    </p>
                    {exceptionOverride ? (
                      <div className="mt-1.5">
                        <p className={exceptionOverride.isAvailable ? 'text-sm font-bold text-emerald-700' : 'text-sm font-bold text-red-700'}>
                          {exceptionOverride.isAvailable ? 'Available' : 'Unavailable'}
                        </p>
                        {exceptionOverride.reason && <p className="text-[11px] text-slate-500">{exceptionOverride.reason}</p>}
                      </div>
                    ) : employeeScope ? (
                      hasRule ? (
                        isAvailable && windowRule ? (
                          <div className="mt-1.5">
                            <p className="text-sm font-bold text-emerald-700">
                              <span className="font-mono">{windowRule.startTime}</span> – <span className="font-mono">{windowRule.endTime}</span>
                            </p>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-sm font-bold text-red-600">Unavailable</p>
                        )
                      ) : (
                        <p className="mt-1.5 text-xs text-slate-400">No rule</p>
                      )
                    ) : (
                      <div className="mt-1.5">
                        {dayRules.length === 0 ? (
                          <p className="text-xs text-slate-400">No rules</p>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-sm font-bold text-emerald-700">
                              {available.length} available
                            </p>
                            {unavailable.length > 0 && (
                              <p className="text-xs text-slate-500">{unavailable.length} unavailable</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Recurring availability rules</CardTitle>
          <CardDescription>Weekly patterns for when each employee can work.</CardDescription>
        </CardHeader>
        <CardContent>
          {rules.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-200/60" />
              ))}
            </div>
          ) : ruleList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
              <CalendarClock className="mx-auto h-7 w-7 text-slate-400" />
              <p className="mt-1 font-semibold text-slate-700">No availability rules yet</p>
              <p className="text-sm text-slate-500">Add a rule to set weekly available hours.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {isManager && <th className="py-2 pr-3">Employee</th>}
                    <th className="py-2 pr-3">Day</th>
                    <th className="py-2 pr-3">Window</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Effective</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleList.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      {isManager && <td className="py-2 pr-3 font-medium text-slate-800">{employeeName(r.employeeId)}</td>}
                      <td className="py-2 pr-3 text-slate-700">{DAY_NAMES[r.dayOfWeek]}</td>
                      <td className="py-2 pr-3 font-mono text-slate-700">
                        {r.isAvailable ? `${r.startTime} – ${r.endTime}` : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            r.isAvailable
                              ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
                              : 'inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700'
                          }
                        >
                          {r.isAvailable ? 'Available' : 'Unavailable'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-slate-500">{format(parseISO(r.effectiveFrom), 'MMM d, yyyy')}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditingRule(r);
                              setRuleForm({
                                employeeId: r.employeeId,
                                dayOfWeek: String(r.dayOfWeek),
                                startTime: r.isAvailable ? r.startTime : '09:00',
                                endTime: r.isAvailable ? r.endTime : '17:00',
                                isAvailable: String(r.isAvailable),
                                effectiveFrom: r.effectiveFrom.slice(0, 10),
                              });
                              setShowRule(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => deleteRule.mutate(r.id)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">Exceptions</CardTitle>
          <CardDescription>One-off days someone is (un)available, e.g. time off or an appointment.</CardDescription>
        </CardHeader>
        <CardContent>
          {exceptions.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-200/60" />
              ))}
            </div>
          ) : exceptionList.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No exceptions. Add one to mark a specific day.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {exceptionList.map((ex) => (
                <div key={ex.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {isManager && <span className="font-medium text-slate-800">{employeeName(ex.employeeId)}</span>}
                    <span
                      className={
                        ex.isAvailable
                          ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
                          : 'inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700'
                      }
                    >
                      {ex.isAvailable ? 'Available' : 'Unavailable'}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{format(parseISO(ex.date), 'EEEE, MMM d, yyyy')}</span>
                    {ex.reason && <span className="text-sm text-slate-500">— {ex.reason}</span>}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => deleteException.mutate(ex.id)}>
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rule modal */}
      <Modal open={showRule} onOpenChange={(o) => !o && setShowRule(false)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>{editingRule ? 'Edit availability rule' : 'New availability rule'}</ModalTitle>
            <ModalDescription>Set a weekly availability window for an employee.</ModalDescription>
          </ModalHeader>
          <form onSubmit={handleRuleSubmit} className="space-y-4">
            {isManager && !editingRule && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Employee</label>
                <select
                  value={ruleForm.employeeId}
                  onChange={(e) => setRuleForm({ ...ruleForm, employeeId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {(employees?.data ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Day of week</label>
                <select value={ruleForm.dayOfWeek} onChange={(e) => setRuleForm({ ...ruleForm, dayOfWeek: e.target.value })} className={inputClass}>
                  {DAY_NAMES.map((d, i) => (
                    <option key={d} value={String(i)}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Availability</label>
                <select value={ruleForm.isAvailable} onChange={(e) => setRuleForm({ ...ruleForm, isAvailable: e.target.value })} className={inputClass}>
                  <option value="true">Available</option>
                  <option value="false">Unavailable</option>
                </select>
              </div>
              {ruleForm.isAvailable === 'true' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Start (HH:mm)</label>
                  <input type="time" value={ruleForm.startTime} onChange={(e) => setRuleForm({ ...ruleForm, startTime: e.target.value })} className={inputClass} />
                </div>
              )}
              {!editingRule && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Effective from</label>
                  <input type="date" value={ruleForm.effectiveFrom} onChange={(e) => setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })} className={inputClass} />
                </div>
              )}
            </div>
            {ruleForm.isAvailable === 'true' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">End (HH:mm)</label>
                <input type="time" value={ruleForm.endTime} onChange={(e) => setRuleForm({ ...ruleForm, endTime: e.target.value })} className={inputClass} />
              </div>
            )}

            {saveRule.isError && formError && (
              <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">{formError}</div>
            )}

            <ModalFooter className="pt-2">
              <ModalClose asChild>
                <Button variant="secondary">Cancel</Button>
              </ModalClose>
              <Button type="submit" disabled={saveRule.isPending}>
                {saveRule.isPending ? 'Saving…' : editingRule ? 'Save changes' : 'Add rule'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Exception modal */}
      <Modal open={showException} onOpenChange={(o) => !o && setShowException(false)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add exception</ModalTitle>
            <ModalDescription>Mark a specific day as (un)available.</ModalDescription>
          </ModalHeader>
          <form onSubmit={handleExceptionSubmit} className="space-y-4">
            {isManager && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Employee</label>
                <select
                  value={exceptionForm.employeeId}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, employeeId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {(employees?.data ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Date</label>
              <input type="date" value={exceptionForm.date} onChange={(e) => setExceptionForm({ ...exceptionForm, date: e.target.value })} className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Reason (optional)</label>
              <input value={exceptionForm.reason} onChange={(e) => setExceptionForm({ ...exceptionForm, reason: e.target.value })} className={inputClass} placeholder="e.g. Appointment" />
            </div>

            {saveException.isError && formError && (
              <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">{formError}</div>
            )}

            <ModalFooter className="pt-2">
              <ModalClose asChild>
                <Button variant="secondary">Cancel</Button>
              </ModalClose>
              <Button type="submit" disabled={saveException.isPending}>
                {saveException.isPending ? 'Saving…' : 'Add exception'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}
