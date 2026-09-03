'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UmbrellaOff } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  createLeaveRequest,
  fetchLeaveBalances,
  fetchLeaveRequests,
  fetchLeaveTypes,
  fetchMyEmployee,
  reviewLeaveRequest,
} from '@/lib/api/queries';
import { getAuthUser } from '@/lib/auth';
import { format, parseISO } from 'date-fns';

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

function dayDiff(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

export default function LeavePage() {
  const queryClient = useQueryClient();
  const user = getAuthUser();
  const isManager = useMemo(() => {
    if (!user) return false;
    const roles = user.roles.map((r) => r.toLowerCase());
    return roles.some((r) => ['owner', 'admin', 'manager'].includes(r));
  }, [user]);

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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leave</h1>
          <p className="text-sm text-muted-foreground">
            {isManager ? 'All leave requests' : 'Your leave and balances'}
          </p>
        </div>
        <button
          onClick={() => setShowRequest(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          Request leave
        </button>
      </div>

      {showBalances && balances && balances.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((b) => (
            <Card key={b.id}>
              <CardHeader>
                <CardTitle className="text-sm">{b.leaveType.name}</CardTitle>
                <CardDescription>{b.year}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {b.remainingDays}
                  <span className="text-sm font-normal text-muted-foreground"> / {b.allocatedDays} days</span>
                </p>
                <p className="text-xs text-muted-foreground">{b.usedDays} used</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isManager ? 'Requests' : 'My requests'}</CardTitle>
          <CardDescription>Leave requests and their status</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {requestList.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <UmbrellaOff className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {isManager ? 'No leave requests yet.' : 'You have no leave requests yet.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {requestList.map((r) => (
                <li key={r.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {r.leaveType.name}
                        {isManager && ` · ${r.employee.firstName} ${r.employee.lastName}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(r.startDate as string), 'MMM d')} –{' '}
                        {format(parseISO(r.endDate as string), 'MMM d')} · {r.requestedDays} day
                        {r.requestedDays === 1 ? '' : 's'}
                      </p>
                      {r.reason && <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={r.status} />
                      {isManager && r.status === 'pending' && (
                        <>
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

      {showRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-lg">
            <div className="border-b border-border p-5">
              <h2 className="text-lg font-semibold">Request leave</h2>
              <p className="text-sm text-muted-foreground">Submit a new time-off request</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Leave type <span className="text-destructive">*</span>
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
                  <label className="text-sm font-medium">
                    Start <span className="text-destructive">*</span>
                  </label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    End <span className="text-destructive">*</span>
                  </label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputClass} />
                </div>
              </div>
              {form.startDate && form.endDate && form.endDate >= form.startDate && (
                <p className="text-xs text-muted-foreground">
                  {dayDiff(form.startDate, form.endDate)} day{dayDiff(form.startDate, form.endDate) === 1 ? '' : 's'} requested
                </p>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Reason</label>
                <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} className={inputClass} />
              </div>

              {formError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowRequest(false)}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={create.isPending}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {create.isPending ? 'Submitting…' : 'Submit request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}