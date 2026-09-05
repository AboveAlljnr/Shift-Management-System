'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UmbrellaOff } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
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
  createLeaveRequest,
  fetchLeaveBalances,
  fetchLeaveRequests,
  fetchLeaveTypes,
  fetchMyEmployee,
  reviewLeaveRequest,
} from '@/lib/api/queries';
import { getAuthUser, getPersonaInfo } from '@/lib/auth';
import { format, parseISO } from 'date-fns';

const inputClass =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';

const BALANCE_COLORS = ['#3B57E8', '#16A34A', '#7C3AED', '#D97706', '#0891B2', '#DB2777'];

function dayDiff(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

export default function LeavePage() {
  const queryClient = useQueryClient();
  const user = getAuthUser();
  const persona = getPersonaInfo(user);
  const isManager = persona.role === 'OWNER' || persona.role === 'MANAGER' || persona.role === 'SUPERVISOR';


  const { data: me } = useQuery({ queryKey: ['myEmployee'], queryFn: fetchMyEmployee });
  const myEmployeeId = me?.id;

  const { data: types } = useQuery({ queryKey: ['leave-types'], queryFn: fetchLeaveTypes });

  const myRequests = useQuery({
    queryKey: ['leave', 'requests', 'mine'],
    queryFn: () => fetchLeaveRequests({ employeeId: myEmployeeId as string }),
    enabled: !!myEmployeeId,
  });

  const allRequests = useQuery({
    queryKey: ['leave', 'requests', 'all'],
    queryFn: () => fetchLeaveRequests(),
    enabled: isManager,
    staleTime: 30 * 1000,
  });

  const { data: balances } = useQuery({
    queryKey: ['leave', 'balances', myEmployeeId],
    queryFn: () => fetchLeaveBalances(myEmployeeId as string),
    enabled: !!myEmployeeId,
  });

  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      reviewLeaveRequest(id, { action }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['leave', 'requests'] });
      const wasMine = updated.employeeId === myEmployeeId;
      if (wasMine) queryClient.invalidateQueries({ queryKey: ['leave', 'balances'] });
    },
  });

  const [showRequest, setShowRequest] = useState(false);
  const [form, setForm] = useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createLeaveRequest({
        leaveTypeId: form.leaveTypeId,
        startDate: new Date(form.startDate + 'T00:00:00').toISOString(),
        endDate: new Date(form.endDate + 'T00:00:00').toISOString(),
        requestedDays: dayDiff(form.startDate, form.endDate),
        reason: form.reason || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave', 'requests'] });
      setShowRequest(false);
      setForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
      setFormError(null);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Unable to submit request'),
  });

  const requestList = isManager ? (allRequests.data ?? []) : (myRequests.data ?? []);
  const showBalances = !isManager || !!me;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.leaveTypeId) return setFormError('Leave type is required');
    if (!form.startDate || !form.endDate) return setFormError('Start and end dates are required');
    if (form.endDate < form.startDate) return setFormError('End date must be on or after start date');
    create.mutate();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Leave"
          subtitle={isManager ? 'All leave requests' : 'Your leave and balances'}
        />
        <Button onClick={() => setShowRequest(true)}>
          Request leave
        </Button>
      </div>

      {showBalances && balances && balances.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((b, i) => {
            const color = BALANCE_COLORS[i % BALANCE_COLORS.length];
            const pct = b.allocatedDays > 0 ? Math.min(100, (b.remainingDays / b.allocatedDays) * 100) : 0;
            return (
              <Card key={b.id} className="overflow-hidden">
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      {b.leaveType.name}
                      {b.leaveType.isPaid && <span className="ml-1.5 text-[10px] font-semibold normal-case text-emerald-600">paid</span>}
                    </p>
                    <div className="h-2 w-2 rounded-full" style={{ background: color }} />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <p className="text-3xl font-bold font-sans text-slate-900">{b.remainingDays}</p>
                    <p className="text-xs text-slate-400">/ {b.allocatedDays} days</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{b.usedDays} used · {b.year}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-sans">{isManager ? 'Requests' : 'My requests'}</CardTitle>
          <CardDescription>Leave requests and their status</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {requestList.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <UmbrellaOff className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm text-slate-500">
                {isManager ? 'No leave requests yet.' : 'You have no leave requests yet.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {requestList.map((r) => (
                <li key={r.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {r.leaveType.name}
                        {isManager && ` · ${r.employee.firstName} ${r.employee.lastName}`}
                      </p>
                      <p className="text-xs text-slate-400">
                        {format(parseISO(r.startDate as string), 'MMM d')} –{' '}
                        {format(parseISO(r.endDate as string), 'MMM d')} · {r.requestedDays} day
                        {r.requestedDays === 1 ? '' : 's'}
                      </p>
                      {r.reason && <p className="mt-1 text-xs text-slate-500">{r.reason}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={r.status} />
                      {isManager && r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => review.mutate({ id: r.id, action: 'approve' })}
                            disabled={review.isPending}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => review.mutate({ id: r.id, action: 'reject' })}
                            disabled={review.isPending}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal open={showRequest} onOpenChange={setShowRequest}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Request leave</ModalTitle>
            <ModalDescription>Submit a new time-off request</ModalDescription>
          </ModalHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Leave type <span className="text-red-500">*</span>
              </label>
              <select value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })} className={inputClass}>
                <option value="">Select…</option>
                {(types ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isPaid ? ' (paid)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Start <span className="text-red-500">*</span>
                </label>
                <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  End <span className="text-red-500">*</span>
                </label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputClass} />
              </div>
            </div>
            {form.startDate && form.endDate && form.endDate >= form.startDate && (
              <p className="text-xs text-slate-500">
                {dayDiff(form.startDate, form.endDate)} day{dayDiff(form.startDate, form.endDate) === 1 ? '' : 's'} requested
              </p>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Reason</label>
              <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} className={inputClass} />
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
                {create.isPending ? 'Submitting…' : 'Submit request'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  );
}