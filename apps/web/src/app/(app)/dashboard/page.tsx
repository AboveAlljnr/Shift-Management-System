'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import Link from 'next/link';
import type { Route } from 'next';
import { useMemo, useState, useEffect } from 'react';
import {
  MapPin,
  Calendar,
  Clock,
  Plane,
  Users,
  AlertTriangle,
  Zap,
  Shield,
  ChevronRight,
  ArrowRight,
  Send,
  TrendingUp,
  Building2,
  BarChart3,
  Sparkles,
  Radio,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  CalendarClock,
  Smartphone,
  CreditCard,
  Settings,
  Activity,
  User,
  Layers,
  Check,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import {
  fetchAuditLogs,
  fetchBranches,
  fetchCompany,
  fetchCoverage,
  fetchDailyAttendance,
  fetchDepartments,
  fetchEmployeeAttendance,
  fetchEmployees,
  fetchGeofenceConfig,
  fetchLeaveBalances,
  fetchLeaveRequests,
  fetchMyEmployee,
  fetchMyGeofenceStatus,
  fetchMyShifts,
  fetchPresenceVerifications,
  fetchShifts,
  recordClockEvent,
  reviewLeaveRequest,
  type AuditLogEntry,
  type EmployeeDetail,
  type PresenceVerificationListItem,
  type ShiftDetail,
} from '@/lib/api/queries';
import type { Branch } from '@sms/shared';
import { getAuthUser, getPersonaInfo, getPrimaryRole, type PersonaRole } from '@/lib/auth';
import { cn, formatTime, getInitials } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

const today = new Date();
const todayISO = today.toISOString().slice(0, 10);
const weekEndISO = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function statClass(tone: string) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500';
    case 'warning':
      return 'bg-amber-500';
    case 'danger':
      return 'bg-rose-500';
    default:
      return 'bg-slate-300';
  }
}

function StatCard({
  label,
  value,
  tone,
  href,
  icon,
  color = '#3B57E8',
  sub,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  href?: Route;
  icon?: React.ReactNode;
  color?: string;
  sub?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  const body = (
    <Card className="p-5 hover:border-slate-300 transition-all rounded-2xl group shadow-sm">
      {icon ? (
        <div className="flex items-start gap-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105 shadow-sm"
            style={{ background: `${color}18` }}
          >
            <span style={{ color }}>{icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">
              {label}
            </p>
            <p className="text-2xl font-extrabold text-slate-900 leading-tight font-sans">{value}</p>
            {sub && (
              <div className="flex items-center gap-1.5 mt-1.5">
                {trend === 'up' && <TrendingUp size={12} className="text-emerald-500 flex-shrink-0" />}
                <p className="text-[11px] text-slate-500 truncate">{sub}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 font-mono">{label}</p>
            <p className="text-3xl font-extrabold text-slate-900 font-sans">{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          </div>
          <span className={cn('inline-block h-2.5 w-2.5 rounded-full mt-1', tone ? statClass(tone) : 'bg-slate-200')} />
        </div>
      )}
    </Card>
  );

  if (href) {
    return <Link href={href}>{body}</Link>;
  }
  return body;
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function CoverageRing({ filled, required }: { filled: number; required: number }) {
  const pct = required > 0 ? Math.min(filled / required, 1) : 1;
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  const color = pct >= 0.9 ? '#16A34A' : pct >= 0.7 ? '#D97706' : '#DC2626';

  return (
    <div className="relative w-16 h-16 flex items-center justify-center flex-shrink-0">
      <svg className="absolute inset-0 -rotate-90" width="64" height="64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-700" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="text-center z-10">
        <p className="text-xs font-bold text-white" style={{ color }}>{Math.round(pct * 100)}%</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const user = getAuthUser();
  const naturalPrimary = useMemo(() => getPrimaryRole(user), [user]);
  const [activePersona, setActivePersona] = useState<PersonaRole | null>(null);

  const effectivePersona = activePersona ?? naturalPrimary;
  const personaInfo = getPersonaInfo(user);

  const { data: company, isLoading: companyLoading } = useQuery({
    queryKey: ['company'],
    queryFn: fetchCompany,
    staleTime: 5 * 60 * 1000,
  });

  if (companyLoading || !company) {
    return (
      <div className="space-y-6">
        <div className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Persona Context Banner & Quick Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0"
            style={{ backgroundColor: personaInfo.accentHex }}
          >
            {effectivePersona === 'OWNER' && <Building2 size={18} />}
            {effectivePersona === 'MANAGER' && <BarChart3 size={18} />}
            {effectivePersona === 'SUPERVISOR' && <Shield size={18} />}
            {effectivePersona === 'EMPLOYEE' && <User size={18} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                {company.name}
              </span>
              <span className="text-slate-300">·</span>
              <span
                className="text-[11px] font-extrabold px-2 py-0.5 rounded-md border uppercase"
                style={{
                  backgroundColor: `${personaInfo.accentHex}15`,
                  borderColor: `${personaInfo.accentHex}30`,
                  color: personaInfo.accentHex,
                }}
              >
                {effectivePersona} WORKSPACE
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {effectivePersona === 'OWNER' && 'Executive governance, organization hierarchy, audit logs, and company metrics.'}
              {effectivePersona === 'MANAGER' && 'AI shift generation, leave approvals, availability rules, and staff schedules.'}
              {effectivePersona === 'SUPERVISOR' && 'Live floor radar, real-time presence verifications, and shift execution.'}
              {effectivePersona === 'EMPLOYEE' && 'Personal geofenced punch clock, upcoming shifts, availability, and PTO requests.'}
            </p>
          </div>
        </div>

        {/* Demo Persona Switcher Pill */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto flex-shrink-0">
          <span className="text-[10px] font-bold text-slate-500 uppercase px-2">Role View:</span>
          {(['OWNER', 'MANAGER', 'SUPERVISOR', 'EMPLOYEE'] as PersonaRole[]).map((p) => {
            const isSelected = effectivePersona === p;
            return (
              <button
                key={p}
                onClick={() => setActivePersona(p)}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer',
                  isSelected
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                    : 'text-slate-500 hover:text-slate-800',
                )}
              >
                {p === 'OWNER' && 'Owner'}
                {p === 'MANAGER' && 'Manager'}
                {p === 'SUPERVISOR' && 'Supervisor'}
                {p === 'EMPLOYEE' && 'Employee'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Render the specific persona dashboard */}
      {effectivePersona === 'OWNER' && <OwnerDashboard company={company} />}
      {effectivePersona === 'MANAGER' && <ManagerDashboard companyName={company.name} />}
      {effectivePersona === 'SUPERVISOR' && <SupervisorDashboard companyName={company.name} />}
      {effectivePersona === 'EMPLOYEE' && <EmployeeDashboard />}
    </div>
  );
}

// ============================================================
// 1. OWNER / EXECUTIVE DASHBOARD
// ============================================================

function OwnerDashboard({ company }: { company: { name: string; timezone: string } }) {
  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchEmployees({ limit: 100 }),
    staleTime: 60 * 1000,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: fetchBranches,
    staleTime: 5 * 60 * 1000,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
    staleTime: 5 * 60 * 1000,
  });

  const { data: geofenceConfig } = useQuery({
    queryKey: ['geofenceConfig'],
    queryFn: fetchGeofenceConfig,
  });

  const { data: auditLogPage } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => fetchAuditLogs({ limit: 8 }),
    staleTime: 30 * 1000,
  });
  const auditLogs = auditLogPage?.items ?? [];

  const totalStaff = employees?.pagination?.total ?? (employees?.data ?? []).length;
  const activeStaff = (employees?.data ?? []).filter((e) => e.status === 'active').length;
  const activeBranches = branches.filter((b) => b.isActive).length;
  const activeDepts = departments.filter((d) => d.isActive).length;

  return (
    <div className="space-y-6">
      {/* Executive Hero Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-purple-900/40 relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-extrabold uppercase tracking-widest border border-purple-500/30">
                EXECUTIVE CONTROL CENTER
              </span>
              <span className="text-slate-400 text-xs font-mono">{format(today, 'MMMM d, yyyy')}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white font-sans tracking-tight">
              {company.name} Overview
            </h1>
            <p className="text-slate-300 text-sm mt-1 max-w-xl">
              System governance, multi-location workforce metrics, and organizational compliance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/organization"
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-2"
            >
              <Building2 size={14} />
              Manage Branches
            </Link>
            <Link
              href="/workforce"
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-2"
            >
              <Users size={14} />
              Staff Directory
            </Link>
            <Link
              href="/settings"
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-2"
            >
              <Settings size={14} />
              System Settings
            </Link>
          </div>
        </div>
      </div>

      {/* 4 Executive KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Workforce"
          value={totalStaff}
          sub={`${activeStaff} active employees`}
          icon={<Users size={20} />}
          color="#7C3AED"
          href="/workforce"
        />
        <StatCard
          label="Operating Locations"
          value={activeBranches}
          sub={`${activeDepts} departments assigned`}
          icon={<Building2 size={20} />}
          color="#2563EB"
          href="/organization"
        />
        <StatCard
          label="Geofence Policy"
          value={geofenceConfig?.mode?.toUpperCase() ?? 'STRICT'}
          sub={geofenceConfig?.mode === 'strict' ? 'Strict boundary enforcement' : 'Standard compliance'}
          icon={<ShieldCheck size={20} />}
          color="#059669"
          href="/settings"
        />
        <StatCard
          label="Platform Plan"
          value="PRO TIER"
          sub="All features enabled ($0 Free tier)"
          icon={<CreditCard size={20} />}
          color="#D97706"
          href="/billing"
        />
      </div>

      {/* Organization Operating Branches Grid */}
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 font-sans">Active Operating Branches</CardTitle>
            <CardDescription>Multi-location operational status</CardDescription>
          </div>
          <Link href="/organization" className="text-xs font-bold text-brand hover:underline flex items-center gap-1">
            Configure Locations <ChevronRight size={14} />
          </Link>
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No branch locations configured.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {branches.map((b) => (
                <div key={b.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-purple-600" />
                      <p className="text-sm font-bold text-slate-900">{b.name}</p>
                    </div>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase', b.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600')}>
                      {b.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">Code: {b.code} · {b.timezone}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security & Operational Audit Log */}
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 font-sans">Recent System & Audit Activity</CardTitle>
            <CardDescription>Real-time security and operational events</CardDescription>
          </div>
          <Link href="/activities" className="text-xs font-bold text-brand hover:underline flex items-center gap-1">
            Full Audit Trail <ChevronRight size={14} />
          </Link>
        </CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No audit activity recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditLogs.slice(0, 5).map((log: AuditLogEntry) => (
                <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                      <Activity size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {log.action.replace(/\./g, ' ').replace(/_/g, ' ').toUpperCase()}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {log.actorEmail ? log.actorEmail : 'System'} · Resource: {log.resource}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                    {format(parseISO(log.occurredAt), 'MMM d, HH:mm')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// 2. OPERATIONS MANAGER DASHBOARD
// ============================================================

function ManagerDashboard({ companyName }: { companyName: string }) {
  const queryClient = useQueryClient();
  const [reviewError, setReviewError] = useState<string | null>(null);

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => fetchEmployees({ limit: 100 }),
    staleTime: 60 * 1000,
  });

  const { data: weekShifts } = useQuery({
    queryKey: ['shifts', todayISO, weekEndISO],
    queryFn: () => fetchShifts({ startDate: todayISO, endDate: weekEndISO }),
    staleTime: 60 * 1000,
  });

  const { data: dailyAttendance } = useQuery({
    queryKey: ['attendance', 'daily', todayISO],
    queryFn: () => fetchDailyAttendance(todayISO),
    staleTime: 60 * 1000,
  });

  const { data: pendingLeave } = useQuery({
    queryKey: ['leave', 'pending'],
    queryFn: () => fetchLeaveRequests({ status: 'pending' }),
    staleTime: 30 * 1000,
  });

  const { data: coverage = [] } = useQuery({
    queryKey: ['coverage', 'week', todayISO, weekEndISO],
    queryFn: () => fetchCoverage((weekShifts ?? []).map((s) => s.id)),
    enabled: !!weekShifts && weekShifts.length > 0,
    staleTime: 60 * 1000,
  });

  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      reviewLeaveRequest(id, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave'] }),
    onError: (e) => setReviewError(e instanceof Error ? e.message : 'Review failed'),
  });

  const present = (dailyAttendance ?? []).filter((a) => ['present', 'late'].includes(a.status)).length;
  const late = (dailyAttendance ?? []).filter((a) => a.status === 'late').length;

  const todayShifts = (weekShifts ?? []).filter((s) => s.startAt.slice(0, 10) === todayISO);
  const todayCoverage = coverage.filter((c) => todayShifts.some((s) => s.id === c.shiftId));
  const filledToday = todayCoverage.reduce((sum, c) => sum + c.headcountFilled, 0);
  const requiredToday = todayCoverage.reduce((sum, c) => sum + c.headcountRequired, 0);

  const uncovered = coverage.filter((c) => c.shortfall > 0);
  const unfilledCount = uncovered.length;

  return (
    <div className="space-y-6">
      {/* Manager Operations Hero Card */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-blue-900/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <CoverageRing filled={filledToday} required={requiredToday} />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-extrabold uppercase tracking-widest border border-blue-500/30">
                  OPERATIONS HUB
                </span>
                <span className="text-slate-400 text-xs font-mono">{format(today, 'EEEE, MMM d')}</span>
              </div>
              <h2 className="text-2xl font-extrabold text-white font-sans">
                Shift Scheduling & Roster Command
              </h2>
              <p className="text-slate-300 text-sm mt-0.5">
                {filledToday} of {requiredToday} required shifts filled for today ({unfilledCount} shortfalls across the week).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/schedule"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-2"
            >
              <Sparkles size={14} className="text-amber-300" />
              Run AI Auto-Scheduler
            </Link>
            <Link
              href="/leave"
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-2"
            >
              <Plane size={14} />
              Review Leave ({pendingLeave?.length ?? 0})
            </Link>
          </div>
        </div>
      </div>

      {/* 4 Operations KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today's Shift Coverage"
          value={requiredToday > 0 ? `${Math.round((filledToday / requiredToday) * 100)}%` : '100%'}
          sub={`${filledToday}/${requiredToday} slots filled today`}
          icon={<Calendar size={20} />}
          color="#2563EB"
          href="/schedule"
        />
        <StatCard
          label="Understaffed Shifts"
          value={unfilledCount}
          sub={unfilledCount > 0 ? 'Requires attention in matrix' : 'All shifts covered'}
          icon={<AlertTriangle size={20} />}
          color={unfilledCount > 0 ? '#DC2626' : '#16A34A'}
          href="/schedule"
        />
        <StatCard
          label="Pending Leave Requests"
          value={pendingLeave?.length ?? 0}
          sub="Awaiting manager sign-off"
          icon={<Plane size={20} />}
          color="#D97706"
          href="/leave"
        />
        <StatCard
          label="Late / Absent Today"
          value={late}
          sub={`${present} workers clocked in`}
          icon={<Clock size={20} />}
          color="#7C3AED"
          href="/attendance"
        />
      </div>

      {/* Pending Leave Approvals Queue */}
      {pendingLeave && pendingLeave.length > 0 && (
        <Card className="rounded-2xl shadow-sm border-amber-200 bg-amber-50/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-slate-900 font-sans flex items-center gap-2">
              <Plane size={16} className="text-amber-600" />
              Pending Leave Approval Queue ({pendingLeave.length})
            </CardTitle>
            <CardDescription>Review and action staff time-off requests</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingLeave.slice(0, 3).map((lr) => (
              <div key={lr.id} className="p-3.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-800">
                    {lr.employee?.firstName} {lr.employee?.lastName} · <span className="text-amber-700">{lr.leaveType?.name ?? 'Leave'}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {format(parseISO(lr.startDate), 'MMM d')} – {format(parseISO(lr.endDate), 'MMM d, yyyy')} ({lr.requestedDays} days)
                    {lr.reason && ` · Reason: ${lr.reason}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => review.mutate({ id: lr.id, action: 'approve' })}
                    disabled={review.isPending}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => review.mutate({ id: lr.id, action: 'reject' })}
                    disabled={review.isPending}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Today's Active Shifts Table */}
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 font-sans">Today&apos;s Scheduled Shifts</CardTitle>
            <CardDescription>Active roster for {format(today, 'MMMM d')}</CardDescription>
          </div>
          <Link href="/schedule" className="text-xs font-bold text-brand hover:underline flex items-center gap-1">
            Open Schedule Matrix <ChevronRight size={14} />
          </Link>
        </CardHeader>
        <CardContent>
          {todayShifts.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No shifts scheduled for today.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayShifts.map((s) => (
                <div key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-400">
                      {formatTime(s.startAt)} – {formatTime(s.endAt)} · Branch: {s.branch?.name ?? 'Assigned'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-500">
                      {s.assignments?.length ?? 0} assigned
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// 3. SHIFT SUPERVISOR DASHBOARD
// ============================================================

function SupervisorDashboard({ companyName }: { companyName: string }) {
  const { data: dailyAttendance } = useQuery({
    queryKey: ['attendance', 'daily', todayISO],
    queryFn: () => fetchDailyAttendance(todayISO),
    staleTime: 30 * 1000,
  });

  const { data: presenceVerifications = [] } = useQuery({
    queryKey: ['presenceVerifications'],
    queryFn: () => fetchPresenceVerifications(),
    staleTime: 30 * 1000,
  });

  const { data: todayShifts = [] } = useQuery({
    queryKey: ['shifts', todayISO, todayISO],
    queryFn: () => fetchShifts({ startDate: todayISO, endDate: todayISO }),
    staleTime: 30 * 1000,
  });

  const present = (dailyAttendance ?? []).filter((a) => ['present', 'late'].includes(a.status)).length;
  const late = (dailyAttendance ?? []).filter((a) => a.status === 'late').length;
  const exceptions = presenceVerifications.filter((p) => p.status === 'MISSED' || p.status === 'OUTSIDE_GEOFENCE').length;

  return (
    <div className="space-y-6">
      {/* Supervisor Command Hero Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-emerald-900/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold uppercase tracking-widest border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                LIVE FLOOR RADAR
              </span>
              <span className="text-slate-400 text-xs font-mono">{format(today, 'HH:mm · EEEE, MMM d')}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white font-sans tracking-tight">
              Shift Operations & Floor Verification
            </h1>
            <p className="text-slate-300 text-sm mt-1">
              Real-time worker check-in tracking, geofence radius verification, and active shift headcount.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/attendance"
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-2"
            >
              <ShieldCheck size={14} />
              Presence Radar
            </Link>
            <Link
              href="/schedule"
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-2"
            >
              <Calendar size={14} />
              Shift Roster
            </Link>
            <Link
              href="/mobile"
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-2"
            >
              <Smartphone size={14} />
              Mobile Punch
            </Link>
          </div>
        </div>
      </div>

      {/* 4 Supervisor Floor KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="On Duty Now"
          value={present}
          sub={`${late} clocked in late`}
          icon={<Users size={20} />}
          color="#059669"
          href="/attendance"
        />
        <StatCard
          label="Geofence Exceptions"
          value={exceptions}
          sub={exceptions > 0 ? 'Missed or outside fence' : 'All check-ins verified'}
          icon={<ShieldAlert size={20} />}
          color={exceptions > 0 ? '#DC2626' : '#16A34A'}
          href="/attendance"
        />
        <StatCard
          label="Active Shifts Today"
          value={todayShifts.length}
          sub="On-floor shifts scheduled"
          icon={<Calendar size={20} />}
          color="#2563EB"
          href="/schedule"
        />
        <StatCard
          label="Floor Status"
          value="ACTIVE"
          sub="Live presence verification ON"
          icon={<Radio size={20} />}
          color="#7C3AED"
          href="/attendance"
        />
      </div>

      {/* Real-time Presence Verification Radar Feed */}
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 font-sans">Live Presence & Geofence Verifications</CardTitle>
            <CardDescription>On-site worker location check-in stream</CardDescription>
          </div>
          <Link href="/attendance" className="text-xs font-bold text-brand hover:underline flex items-center gap-1">
            View All Verifications <ChevronRight size={14} />
          </Link>
        </CardHeader>
        <CardContent>
          {presenceVerifications.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No presence verification records for current shift window.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {presenceVerifications.slice(0, 6).map((pv: PresenceVerificationListItem) => (
                <div key={pv.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0',
                        pv.status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
                      )}
                    >
                      {pv.status === 'VERIFIED' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {pv.employeeName} <span className="text-slate-400 font-normal">({pv.employeeNumber})</span>
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {pv.branchName ?? 'Unknown branch'} · Distance: {pv.distanceMeters != null ? `${Math.round(pv.distanceMeters)}m` : 'N/A'}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full uppercase',
                      pv.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200',
                    )}
                  >
                    {pv.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// 4. EMPLOYEE DASHBOARD
// ============================================================

function EmployeeDashboard() {
  const queryClient = useQueryClient();
  const [clockNotice, setClockNotice] = useState<string | null>(null);
  const now = useLiveClock();

  const { data: me } = useQuery({
    queryKey: ['myEmployee'],
    queryFn: fetchMyEmployee,
    staleTime: 5 * 60 * 1000,
  });

  const myEmployeeId = me?.id;

  const { data: myShifts, isLoading: shiftsLoading } = useQuery({
    queryKey: ['shifts', 'mine', todayISO, weekEndISO],
    queryFn: () => fetchMyShifts(myEmployeeId as string, { startDate: todayISO, endDate: weekEndISO }),
    enabled: !!myEmployeeId,
  });

  const { data: attendance } = useQuery({
    queryKey: ['attendance', 'me', myEmployeeId],
    queryFn: () => fetchEmployeeAttendance(myEmployeeId as string),
    enabled: !!myEmployeeId,
  });

  const { data: balances } = useQuery({
    queryKey: ['leave', 'balances', myEmployeeId],
    queryFn: () => fetchLeaveBalances(myEmployeeId as string),
    enabled: !!myEmployeeId,
  });

  const { data: geofenceStatus } = useQuery({
    queryKey: ['attendance', 'me', 'geofence'],
    queryFn: fetchMyGeofenceStatus,
    staleTime: 60 * 1000,
  });

  const [locating, setLocating] = useState(false);

  const clockMutation = useMutation({
    mutationFn: (args: {
      eventType: 'clock_in' | 'clock_out';
      latitude?: number;
      longitude?: number;
    }) =>
      recordClockEvent({
        eventType: args.eventType,
        clientOccurredAt: new Date().toISOString(),
        idempotencyKey: crypto.randomUUID(),
        latitude: args.latitude,
        longitude: args.longitude,
      }),
    onSuccess: () => {
      setClockNotice('Time recorded successfully');
      queryClient.invalidateQueries({ queryKey: ['attendance', 'me'] });
    },
    onError: (e) => setClockNotice(extractClockError(e)),
    onSettled: () => setLocating(false),
  });

  const todaysAttendance = attendance?.find((a) => a.workDate.slice(0, 10) === todayISO);
  const isClockedIn = !!todaysAttendance?.effectiveClockIn && !todaysAttendance?.effectiveClockOut;

  const handleClock = async () => {
    setClockNotice(null);
    if (isClockedIn) {
      clockMutation.mutate({ eventType: 'clock_out' });
      return;
    }

    if (geofenceStatus?.applicable) {
      setLocating(true);
      try {
        const pos = await getCurrentPosition();
        clockMutation.mutate({
          eventType: 'clock_in',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      } catch (locErr) {
        setLocating(false);
        setClockNotice(getLocationErrorMessage(locErr));
      }
      return;
    }

    clockMutation.mutate({ eventType: 'clock_in' });
  };

  const todaysShift = myShifts?.find((s) => s.startAt.slice(0, 10) === todayISO);
  const upcoming = (myShifts ?? []).filter((s) => s.startAt.slice(0, 10) >= todayISO).slice(0, 3);
  const totalAllocated = (balances ?? []).reduce((sum, b) => sum + b.allocatedDays, 0);
  const totalRemaining = (balances ?? []).reduce((sum, b) => sum + b.remainingDays, 0);

  return (
    <div className="space-y-6">
      {/* Employee Greeting & Punch Hero Card */}
      <Card className="rounded-3xl border-slate-200 shadow-md overflow-hidden bg-gradient-to-br from-white via-slate-50 to-sky-50/40">
        <CardContent className="flex flex-col gap-6 p-6 sm:p-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-700 text-[10px] font-extrabold uppercase tracking-widest border border-sky-500/25">
                EMPLOYEE PORTAL
              </span>
              <span className="text-slate-400 text-xs font-mono">{format(today, 'EEEE, MMMM d')}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 font-sans tracking-tight">
              Hello, {me?.firstName ?? 'Team Member'} 👋
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-md">
              {geofenceStatus?.applicable
                ? `Location-verified clocking enabled at ${geofenceStatus.branchName} (within ${Math.round(geofenceStatus.radiusMeters ?? 0)}m).`
                : 'Welcome to your workforce portal. Track your time and shifts.'}
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="text-center sm:text-right">
              <p className="text-2xl font-bold text-slate-900 tabular-nums font-mono">
                {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Live Clock</p>
            </div>

            <button
              onClick={handleClock}
              disabled={clockMutation.isPending || locating}
              className={cn(
                'px-8 py-3.5 text-sm font-extrabold rounded-2xl text-white transition-all shadow-lg active:scale-95 cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2',
                isClockedIn
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
                  : 'bg-brand hover:bg-brand-dark shadow-brand/30',
              )}
            >
              {locating ? (
                'Verifying GPS...'
              ) : clockMutation.isPending ? (
                'Recording...'
              ) : isClockedIn ? (
                <>
                  <Clock size={16} /> CLOCK OUT
                </>
              ) : (
                <>
                  <Clock size={16} /> CLOCK IN
                </>
              )}
            </button>
            {clockNotice && <p className="text-xs text-slate-600 text-right">{clockNotice}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Today's Assigned Shift Card */}
      <div className="bg-sidebar text-white rounded-3xl p-6 shadow-xl border border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">TODAY&apos;S SHIFT</span>
          {todaysShift ? (
            <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-extrabold rounded-full uppercase border border-emerald-500/30">
              Assigned
            </span>
          ) : (
            <span className="px-2.5 py-0.5 bg-slate-800 text-slate-400 text-[10px] font-bold rounded-full uppercase">
              Day Off
            </span>
          )}
        </div>
        <h3 className="text-xl font-bold text-white mb-1 font-sans">
          {todaysShift ? todaysShift.name : 'No shift assigned for today'}
        </h3>
        {todaysShift ? (
          <div className="space-y-2 mt-3">
            <p className="text-slate-200 text-sm font-semibold flex items-center gap-2">
              <Clock size={15} className="text-brand" />
              {formatTime(todaysShift.startAt)} – {formatTime(todaysShift.endAt)}
            </p>
            <p className="text-slate-400 text-xs flex items-center gap-2">
              <MapPin size={15} className="text-purple-400" />
              {todaysShift.branch ? todaysShift.branch.name : 'Primary Branch'}
            </p>
          </div>
        ) : (
          <p className="text-slate-300 text-xs mt-1">
            Enjoy your day off! You can submit availability or check upcoming scheduled shifts below.
          </p>
        )}
      </div>

      {/* 4 Personal KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Next Shifts (7 Days)"
          value={(myShifts ?? []).length}
          sub="Upcoming assigned shifts"
          icon={<Calendar size={20} />}
          color="#0284C7"
          href="/schedule"
        />
        <StatCard
          label="Hours Worked Today"
          value={
            todaysAttendance?.totalWorkedMinutes != null
              ? `${Math.floor(todaysAttendance.totalWorkedMinutes / 60)}h ${todaysAttendance.totalWorkedMinutes % 60}m`
              : '0h 00m'
          }
          tone={todaysAttendance ? (isClockedIn ? 'warning' : 'success') : undefined}
          icon={<Clock size={20} />}
          color="#16A34A"
          href="/attendance"
        />
        <StatCard
          label="Available PTO Leave"
          value={totalRemaining > 0 ? `${totalRemaining} Days` : `${totalAllocated} Days`}
          sub="Annual leave balance"
          icon={<Plane size={20} />}
          color="#D97706"
          href="/leave"
        />
        <StatCard
          label="Today's Status"
          value={isClockedIn ? 'CLOCKED IN' : (todaysAttendance?.status?.toUpperCase() ?? 'OFF DUTY')}
          sub={isClockedIn ? 'Currently on shift' : 'Not clocked in'}
          icon={<ShieldCheck size={20} />}
          color="#7C3AED"
          href="/attendance"
        />
      </div>

      {/* Upcoming Shifts List */}
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-slate-900 font-sans">Upcoming Shifts</CardTitle>
            <CardDescription>Your schedule for the next 7 days</CardDescription>
          </div>
          <Link href="/schedule" className="text-xs font-bold text-brand hover:underline flex items-center gap-1">
            Full Schedule <ChevronRight size={14} />
          </Link>
        </CardHeader>
        <CardContent>
          {shiftsLoading ? (
            <p className="text-sm text-slate-400">Loading schedule...</p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-slate-500 py-3">No upcoming shifts scheduled.</p>
          ) : (
            <div className="space-y-3">
              {upcoming.map((s: ShiftDetail) => (
                <div key={s.id} className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3 hover:border-slate-300 transition-colors">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {format(parseISO(s.startAt), 'EEE, MMM d')} · {formatTime(s.startAt)} – {formatTime(s.endAt)}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Self-Service Fast Links */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/schedule" className="rounded-2xl border border-slate-200 p-5 hover:bg-slate-50 transition-all bg-white group shadow-sm">
          <Calendar size={20} className="text-brand mb-2.5 transition-transform group-hover:scale-110" />
          <p className="text-sm font-bold text-slate-900">My Schedule</p>
          <p className="text-xs text-slate-500 mt-0.5">View your shift assignments</p>
        </Link>
        <Link href="/availability" className="rounded-2xl border border-slate-200 p-5 hover:bg-slate-50 transition-all bg-white group shadow-sm">
          <CalendarClock size={20} className="text-purple-600 mb-2.5 transition-transform group-hover:scale-110" />
          <p className="text-sm font-bold text-slate-900">Set Availability</p>
          <p className="text-xs text-slate-500 mt-0.5">Submit weekly preferences</p>
        </Link>
        <Link href="/leave" className="rounded-2xl border border-slate-200 p-5 hover:bg-slate-50 transition-all bg-white group shadow-sm">
          <Plane size={20} className="text-amber-600 mb-2.5 transition-transform group-hover:scale-110" />
          <p className="text-sm font-bold text-slate-900">Request Leave</p>
          <p className="text-xs text-slate-500 mt-0.5">Plan time off and view balance</p>
        </Link>
      </div>
    </div>
  );
}

// Helpers
function extractClockError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (data?.message) return Array.isArray(data.message) ? data.message.join(', ') : data.message;
  }
  return 'Could not record time. Try again.';
}

function getLocationErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const ge = err as GeolocationPositionError;
    if (ge.code === 1) return 'Location permission denied. Enable location in browser.';
    if (ge.code === 2) return 'Location unavailable. Try again.';
    if (ge.code === 3) return 'Location request timed out.';
  }
  return 'Location error occurred.';
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}