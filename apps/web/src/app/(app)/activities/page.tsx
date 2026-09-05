'use client';

import { useQuery } from '@tanstack/react-query';
import { Shield, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { fetchAuditLogs, type AuditLogEntry } from '@/lib/api/queries';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const AVATAR_COLORS = ['#3B57E8', '#7C3AED', '#0891B2', '#D97706', '#DB2777', '#16A34A'];

function colorFor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? '#3B57E8';
}

function categoryOf(entry: AuditLogEntry): string {
  const r = entry.resource.toLowerCase();
  if (r.includes('employee') || r.includes('certification') || r.includes('skill')) return 'employee';
  if (r.includes('schedule') || r.includes('shift')) return 'schedule';
  if (r.includes('attendance') || r.includes('geofence')) return 'attendance';
  if (r.includes('leave')) return 'leave';
  if (r.includes('conflict')) return 'conflict';
  return 'system';
}

const CATEGORY_STYLES: Record<string, string> = {
  employee: 'bg-brand/10 text-brand',
  schedule: 'bg-emerald-50 text-emerald-700',
  attendance: 'bg-sky-50 text-sky-700',
  leave: 'bg-amber-50 text-amber-700',
  conflict: 'bg-red-50 text-red-700',
  system: 'bg-slate-100 text-slate-600',
};

function actionLabel(action: string): string {
  return action
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function actorName(entry: AuditLogEntry): string {
  if (!entry.actorEmail) return 'System';
  return entry.actorEmail.split('@')[0]?.replace(/[._-]/g, ' ') ?? 'System';
}

function actorInitials(entry: AuditLogEntry): string {
  if (!entry.actorEmail) return 'SY';
  const local = entry.actorEmail.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export default function ActivitiesPage() {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('All actions');

  const { data: page, isLoading, isError } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => fetchAuditLogs({ limit: 200 }),
  });

  const items = useMemo(() => page?.items ?? [], [page]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((e) => {
      const inCategory =
        filterCategory === 'All actions' || categoryOf(e) === filterCategory.toLowerCase();
      if (!inCategory) return false;
      if (!q) return true;
      return (
        actorName(e).toLowerCase().includes(q) ||
        actionLabel(e.action).toLowerCase().includes(q) ||
        e.resource.toLowerCase().includes(q) ||
        (e.resourceId ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search, filterCategory]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield size={18} className="text-slate-400" />
        <PageHeader title="Audit log" subtitle="A complete history of actions taken in your workspace." />
      </div>

      {isError ? (
        <Card>
          <CardContent className="px-6 py-10 text-center">
            <Shield className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-700">Audit log unavailable</p>
            <p className="text-sm text-slate-500">
              Viewing the audit log requires the <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">audit.read</code> permission.
              Ask an administrator for access.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by actor, action, or resource..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                {['All actions', 'Employee', 'Schedule', 'Attendance', 'Leave', 'Conflict', 'System'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/60" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <Shield className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm text-slate-500">
                    {page && page.total > 0
                      ? 'No events match your search.'
                      : 'No audit events recorded yet — actions like clock-ins, schedule publishes, and staff changes will appear here.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-3">Time</th>
                        <th className="px-4 py-3">Actor</th>
                        <th className="px-4 py-3">Action</th>
                        <th className="px-4 py-3">Resource</th>
                        <th className="hidden px-4 py-3 md:table-cell">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map((e) => (
                        <tr key={e.id} className="transition-colors hover:bg-slate-50/80">
                          <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-slate-400">
                            {format(parseISO(e.occurredAt), 'MMM d, HH:mm:ss')}
                            <span className="ml-2 text-[10px] text-slate-300">
                              {formatDistanceToNow(parseISO(e.occurredAt), { addSuffix: true })}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span
                                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                                style={{ background: colorFor(actorName(e)) }}
                              >
                                {actorInitials(e)}
                              </span>
                              <span className="font-medium text-slate-800">{actorName(e)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={cn(
                                'inline-flex rounded px-2 py-0.5 text-[11px] font-semibold',
                                CATEGORY_STYLES[categoryOf(e)],
                              )}
                            >
                              {actionLabel(e.action)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 font-medium text-slate-700">
                            {e.resource}
                            {e.resourceId && <span className="text-xs text-slate-400"> · {e.resourceId.slice(0, 8)}</span>}
                          </td>
                          <td className="hidden max-w-xs truncate px-4 py-3.5 text-xs text-slate-500 md:table-cell">
                            {actionLabel(e.resource)} ({e.action})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
            {page && (
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-400">
                Showing {filtered.length} of {page.total} events · All times in local time
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
