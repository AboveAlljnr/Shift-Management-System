'use client';

import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronRight, Layers, MapPin, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn, getInitials } from '@/lib/utils';
import {
  configureBranchGeofence,
  createBranch as createBranchApi,
  createDepartment as createDepartmentApi,
  createTeam as createTeamApi,
  fetchBranchGeofence,
  fetchBranches,
  fetchCompany,
  fetchDepartments,
  fetchEmployees,
  fetchEmploymentTypes,
  fetchPositions,
  fetchTeams,
  type BranchGeofenceInput,
} from '@/lib/api/queries';

const GeofenceMap = dynamic(() => import('./geofence-map'), { ssr: false });

const AVATAR_COLORS = ['#7C3AED', '#2563EB', '#DC2626', '#0891B2', '#059669', '#D97706', '#64748B', '#16A34A'];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}

type OrgNodeKind = 'company' | 'branch' | 'department' | 'team';

interface OrgNode {
  kind: OrgNodeKind;
  id: string;
  name: string;
  parentPath: string[];
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition shadow-none';

const EMPTY_AVATAR_GROUPS = 30;

export default function OrganizationPage() {
  const { data: company } = useQuery({ queryKey: ['company'], queryFn: fetchCompany });
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams });
  const { data: employees } = useQuery({
    queryKey: ['employees', 'org'],
    queryFn: () => fetchEmployees({ limit: 100 }),
    staleTime: 30 * 1000,
  });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: fetchPositions });
  const { data: employmentTypes } = useQuery({ queryKey: ['employment-types'], queryFn: fetchEmploymentTypes });

  const [selected, setSelected] = useState<OrgNode>({ kind: 'company', id: 'company', name: '', parentPath: [] });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['company']));
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const createBranch = useMutation({
    mutationFn: (name: string) =>
      createBranchApi({
        name,
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'BR',
        timezone: 'UTC',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branches'] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create branch'),
  });

  const createDept = useMutation({
    mutationFn: ({ branchId, name }: { branchId: string; name: string }) =>
      createDepartmentApi({
        branchId,
        name,
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'DEPT',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create department'),
  });

  const createTeam = useMutation({
    mutationFn: ({ departmentId, name }: { departmentId: string; name: string }) =>
      createTeamApi({
        departmentId,
        name,
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'TEAM',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create team'),
  });

  const companyName = company?.name ?? 'Your company';
  const activeEmployees = (employees?.data ?? []).filter((e) => e.status !== 'inactive');
  const branchList = branches ?? [];
  const deptList = departments ?? [];
  const teamList = teams ?? [];

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAndExpand = (node: OrgNode, expand: boolean) => {
    setSelected(node);
    if (expand) toggle(node.id);
  };

  // Refresh the header/sidebar scroll after tree grows
  useEffect(() => {
    setError(null);
  }, [selected.id]);

  const breadcrumb = [companyName, ...selected.parentPath, selected.kind !== 'company' ? selected.name : ''].filter(Boolean);

  const teamsOf = (departmentId: string) => teamList.filter((t) => t.departmentId === departmentId);
  const departmentsOf = (branchId: string) => deptList.filter((d) => d.branchId === branchId);
  const membersOf = (teamId: string) => activeEmployees.filter((e) => e.teamId === teamId);
  const employeesIn = (branchId: string) => activeEmployees.filter((e) => e.branchId === branchId);

  return (
    <div className="space-y-6">
      <PageHeader title="Organization" subtitle="Company structure and branches" />

      {error && (
        <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex min-h-[560px]">
        {/* Tree */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col max-h-[calc(100dvh-12rem)] sticky top-6">
          <div className="p-5 pb-3">
            <h2 className="text-sm font-bold text-slate-900 font-sans">Organization</h2>
            <p className="text-xs text-slate-400 mt-0.5">Company structure</p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <TreeRow
              depth={0}
              label={companyName}
              icon={<Building2 size={13} />}
              selected={selected.kind === 'company'}
              expanded={expanded.has('company')}
              hasChildren={branchList.length > 0}
              onClick={() => selectAndExpand({ kind: 'company', id: 'company', name: companyName, parentPath: [] }, true)}
            />
            {expanded.has('company') &&
              branchList.map((b) => (
                <Fragment key={b.id}>
                  <TreeRow
                    depth={1}
                    label={b.name}
                    icon={<MapPin size={13} />}
                    selected={selected.kind === 'branch' && selected.id === b.id}
                    expanded={expanded.has(b.id)}
                    hasChildren={departmentsOf(b.id).length > 0}
                    onClick={() => selectAndExpand({ kind: 'branch', id: b.id, name: b.name, parentPath: [] }, true)}
                  />
                  {expanded.has(b.id) &&
                    departmentsOf(b.id).map((d) => (
                      <Fragment key={d.id}>
                        <TreeRow
                          depth={2}
                          label={d.name}
                          icon={<Layers size={13} />}
                          selected={selected.kind === 'department' && selected.id === d.id}
                          expanded={expanded.has(d.id)}
                          hasChildren={teamsOf(d.id).length > 0}
                          onClick={() =>
                            selectAndExpand({ kind: 'department', id: d.id, name: d.name, parentPath: [b.name] }, true)
                          }
                        />
                        {expanded.has(d.id) &&
                          teamsOf(d.id).map((t) => (
                            <Fragment key={t.id}>
                              <TreeRow
                                depth={3}
                                label={t.name}
                                icon={<Users size={13} />}
                                selected={selected.kind === 'team' && selected.id === t.id}
                                expanded={expanded.has(t.id)}
                                hasChildren={membersOf(t.id).length > 0}
                                onClick={() =>
                                  selectAndExpand(
                                    { kind: 'team', id: t.id, name: t.name, parentPath: [b.name, d.name] },
                                    true,
                                  )
                                }
                              />
                              {expanded.has(t.id) &&
                                membersOf(t.id).map((emp) => (
                                  <TreeRow
                                    key={emp.id}
                                    depth={4}
                                    label={`${emp.firstName} ${emp.lastName}`}
                                    leaf
                                    avatar={
                                      <Avatar
                                        initials={getInitials(`${emp.firstName} ${emp.lastName}`)}
                                        color={colorFor(`${emp.firstName} ${emp.lastName}`)}
                                        size="sm"
                                        className="scale-75"
                                      />
                                    }
                                    selected={false}
                                    onClick={() => setSelected({ kind: 'team', id: t.id, name: t.name, parentPath: [b.name, d.name] })}
                                  />
                                ))}
                            </Fragment>
                          ))}
                      </Fragment>
                    ))}
                </Fragment>
              ))}
          </div>
        </aside>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-6 flex-wrap min-w-0">
            {breadcrumb.map((crumb, i) => (
              <Fragment key={i}>
                {i > 0 && <ChevronRight size={12} className="opacity-50 flex-shrink-0" />}
                <span className={i === breadcrumb.length - 1 ? 'text-slate-700 font-medium truncate' : 'truncate'}>
                  {crumb}
                </span>
              </Fragment>
            ))}
          </div>

          <div className="max-w-3xl">
            {selected.kind === 'company' && (
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center">
                    <Building2 size={24} className="text-brand" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 font-sans">{companyName}</h2>
                    <p className="text-sm text-slate-500">Parent Company</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Branches', value: branchList.length },
                    { label: 'Departments', value: deptList.length },
                    { label: 'Teams', value: teamList.length },
                    { label: 'Employees', value: activeEmployees.length },
                  ].map((s) => (
                    <div key={s.label} className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
                      <p className="text-2xl font-bold text-slate-900 font-sans">{s.value}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                <CreateBar
                  placeholder="Branch name (e.g. Downtown)"
                  buttonLabel="Add branch"
                  busy={createBranch.isPending}
                  onSubmit={(name) => createBranch.mutate(name)}
                />

                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Branches</h3>
                  <div className="space-y-2">
                    {branchList.length === 0 && (
                      <p className="text-sm text-slate-400">No branches yet. Add your first one above.</p>
                    )}
                    {branchList.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:border-brand/40 transition-colors"
                        onClick={() => selectAndExpand({ kind: 'branch', id: b.id, name: b.name, parentPath: [] }, true)}
                      >
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                          <MapPin size={14} className="text-brand" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{b.name}</p>
                          <p className="text-xs text-slate-400">
                            {departmentsOf(b.id).length} departments · {employeesIn(b.id).length} employees
                          </p>
                        </div>
                        <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Reference data</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
                      <p className="text-xs font-bold text-slate-500 mb-3">Positions</p>
                      <div className="flex flex-wrap gap-2">
                        {(positions ?? []).length === 0 && <p className="text-sm text-slate-400">No positions defined.</p>}
                        {(positions ?? []).map((p) => (
                          <span key={p.id} className="inline-flex items-center rounded-full bg-white border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
                      <p className="text-xs font-bold text-slate-500 mb-3">Employment types</p>
                      <div className="flex flex-wrap gap-2">
                        {(employmentTypes ?? []).length === 0 && (
                          <p className="text-sm text-slate-400">No employment types defined.</p>
                        )}
                        {(employmentTypes ?? []).map((t) => (
                          <span key={t.id} className="inline-flex items-center rounded-full bg-white border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selected.kind === 'branch' &&
              (() => {
                const branch = branchList.find((b) => b.id === selected.id);
                if (!branch) return null;
                const branchDepts = departmentsOf(branch.id);
                const branchTeams = branchDepts.flatMap((d) => teamsOf(d.id)).length;
                return (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center">
                        <MapPin size={24} className="text-sky-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 font-sans">{branch.name}</h2>
                        <p className="text-sm text-slate-500">
                          {branch.code} · {branch.timezone}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: 'Employees', value: employeesIn(branch.id).length },
                        { label: 'Departments', value: branchDepts.length },
                        { label: 'Teams', value: branchTeams },
                      ].map((s) => (
                        <div key={s.label} className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100">
                          <p className="text-2xl font-bold text-slate-900 font-sans">{s.value}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
                        </div>
                      ))}
                    </div>

                    <Card>
                      <div className="p-5 border-b border-slate-100">
                        <h3 className="text-sm font-bold text-slate-900 font-sans">Clock-in geofence</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Defines where employees may clock in at this branch. Location is only requested when an
                          employee clocks in — it is not continuously tracked.
                        </p>
                      </div>
                      <CardContent className="p-5">
                        <BranchGeofenceForm branchId={branch.id} onError={setError} />
                      </CardContent>
                    </Card>

                    <div>
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Departments</h3>
                      <CreateBar
                        placeholder="Department name (e.g. Operations)"
                        buttonLabel="Add department"
                        busy={createDept.isPending}
                        onSubmit={(name) => createDept.mutate({ branchId: branch.id, name })}
                      />
                      <div className="space-y-2 mt-3">
                        {branchDepts.length === 0 && (
                          <p className="text-sm text-slate-400">No departments in this branch yet.</p>
                        )}
                        {branchDepts.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:border-brand/40 transition-colors"
                            onClick={() => selectAndExpand({ kind: 'department', id: d.id, name: d.name, parentPath: [branch.name] }, true)}
                          >
                            <div className="w-7 h-7 rounded-lg bg-brand/10 flex items-center justify-center">
                              <Layers size={13} className="text-brand" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">{d.name}</p>
                              <p className="text-xs text-slate-400">
                                {teamsOf(d.id).length} teams · {d.code}
                              </p>
                            </div>
                            {d.managerId && <Badge variant="info">Has manager</Badge>}
                            <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

            {selected.kind === 'department' &&
              (() => {
                const dept = deptList.find((d) => d.id === selected.id);
                if (!dept) return null;
                const branch = branchList.find((b) => b.id === dept.branchId);
                const deptTeams = teamsOf(dept.id);
                return (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center">
                        <Layers size={24} className="text-violet-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 font-sans">{dept.name}</h2>
                        <p className="text-sm text-slate-500">Department · {branch?.name ?? '—'}</p>
                      </div>
                    </div>

                    <CreateBar
                      placeholder="Team name (e.g. Night Shift)"
                      buttonLabel="Add team"
                      busy={createTeam.isPending}
                      onSubmit={(name) => createTeam.mutate({ departmentId: dept.id, name })}
                    />

                    <div>
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                        Teams ({deptTeams.length})
                      </h3>
                      <div className="space-y-2">
                        {deptTeams.length === 0 && (
                          <p className="text-sm text-slate-400">No teams in this department yet.</p>
                        )}
                        {deptTeams.map((t) => {
                          const members = membersOf(t.id);
                          return (
                            <div
                              key={t.id}
                              className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:border-brand/40 transition-colors"
                              onClick={() =>
                                selectAndExpand(
                                  { kind: 'team', id: t.id, name: t.name, parentPath: [branch?.name ?? '', dept.name] },
                                  true,
                                )
                              }
                            >
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                                <Badge variant="neutral">{members.length} members</Badge>
                              </div>
                              <div className="flex gap-1.5">
                                {members.length === 0 && <span className="text-xs text-slate-400">No members</span>}
                                {members.slice(0, 6).map((m) => (
                                  <Avatar
                                    key={m.id}
                                    initials={getInitials(`${m.firstName} ${m.lastName}`)}
                                    color={colorFor(`${m.firstName} ${m.lastName}`)}
                                    size="sm"
                                  />
                                ))}
                                {members.length > 6 && (
                                  <span className="text-xs text-slate-400 self-center">+{members.length - 6}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

            {selected.kind === 'team' &&
              (() => {
                const teamInfo = teamList.find((t) => t.id === selected.id);
                if (!teamInfo) return null;
                const dept = deptList.find((d) => d.id === teamInfo.departmentId);
                const branch = branchList.find((b) => b.id === dept?.branchId);
                const members = membersOf(teamInfo.id);
                return (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center">
                        <Users size={24} className="text-green-600" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 font-sans">{teamInfo.name}</h2>
                        <p className="text-sm text-slate-500">
                          Team · {dept?.name ?? '—'} · {branch?.name ?? '—'}
                        </p>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                        Members ({members.length})
                      </h3>
                      <div className="space-y-2">
                        {members.length === 0 && (
                          <p className="text-sm text-slate-400">No members assigned to this team.</p>
                        )}
                        {members.map((m) => (
                          <div key={m.id} className="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                            <Avatar
                              initials={getInitials(`${m.firstName} ${m.lastName}`)}
                              color={colorFor(`${m.firstName} ${m.lastName}`)}
                              size="md"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">
                                {m.firstName} {m.lastName}
                              </p>
                              <p className="text-xs text-slate-400 truncate">{m.primaryPosition?.name ?? m.email}</p>
                            </div>
                            <StatusBadge status={m.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function Fragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function TreeRow({
  depth,
  label,
  icon,
  selected,
  expanded,
  hasChildren,
  onClick,
  leaf,
  avatar,
}: {
  depth: number;
  label: string;
  icon?: React.ReactNode;
  selected: boolean;
  expanded?: boolean;
  hasChildren?: boolean;
  onClick: () => void;
  leaf?: boolean;
  avatar?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 rounded-lg cursor-pointer text-sm transition-colors select-none',
        selected ? 'bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
      style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: 8 }}
      onClick={onClick}
    >
      {hasChildren ? (
        expanded ? (
          <ChevronDown size={13} className="flex-shrink-0 opacity-60" />
        ) : (
          <ChevronRight size={13} className="flex-shrink-0 opacity-60" />
        )
      ) : (
        <span className="w-3.5 flex-shrink-0" />
      )}
      {avatar ?? (icon && <span className="opacity-70 flex-shrink-0">{icon}</span>)}
      <span className={cn('font-medium truncate', selected && 'font-semibold')}>{label}</span>
    </div>
  );
}

function CreateBar({
  placeholder,
  buttonLabel,
  busy,
  onSubmit,
}: {
  placeholder: string;
  buttonLabel: string;
  busy: boolean;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState('');
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue('');
  }
  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className={cn(inputClass, 'flex-1')} />
      <Button type="submit" disabled={busy || !value.trim()} className="shrink-0">
        {busy ? 'Saving…' : buttonLabel}
      </Button>
    </form>
  );
}

function getLocationPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

function BranchGeofenceForm({ branchId, onError }: { branchId: string; onError: (e: string | null) => void }) {
  const queryClient = useQueryClient();
  const { data: geofence } = useQuery({
    queryKey: ['branches', branchId, 'geofence'],
    queryFn: () => fetchBranchGeofence(branchId),
  });

  const [latNum, setLatNum] = useState<number | null>(null);
  const [lngNum, setLngNum] = useState<number | null>(null);
  const [radiusMeters, setRadiusMeters] = useState(100);
  const [isActive, setIsActive] = useState(true);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (geofence) {
      setLatNum(geofence.latitude);
      setLngNum(geofence.longitude);
      setRadiusMeters(geofence.radiusMeters);
      setIsActive(geofence.isActive);
    }
  }, [geofence]);

  const save = useMutation({
    mutationFn: (body: BranchGeofenceInput) => configureBranchGeofence(branchId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', branchId, 'geofence'] });
      setStatus('Geofence saved');
      onError(null);
    },
    onError: (e) => onError(e instanceof Error ? e.message : 'Failed to save geofence'),
  });

  const useCurrentLocation = async () => {
    setLocating(true);
    setStatus(null);
    try {
      const pos = await getLocationPosition();
      setLatNum(pos.latitude);
      setLngNum(pos.longitude);
      setStatus('Location captured — adjust the radius or pin, then save.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not get location');
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (latNum === null || lngNum === null) {
      setStatus('Mark the branch location on the map first — drag the pin or use \'Use my current location\'.');
      return;
    }
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setStatus('Enter a valid latitude (-90 to 90)');
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setStatus('Enter a valid longitude (-180 to 180)');
      return;
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      setStatus('Enter a positive radius in meters');
      return;
    }
    save.mutate({ latitude: latNum, longitude: lngNum, radiusMeters: Math.round(radiusMeters), isActive });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <MapPin size={14} className="text-brand" />
          Location &amp; radius
        </p>
        {geofence && (
          <Badge variant={geofence.isActive ? 'success' : 'neutral'}>
            {geofence.isActive ? 'Enabled' : 'Disabled'}
          </Badge>
        )}
        {!geofence && <Badge variant="neutral">Not configured</Badge>}
      </div>

      <GeofenceMap
        latitude={latNum}
        longitude={lngNum}
        radiusMeters={radiusMeters}
        onMove={(lat, lng) => {
          setLatNum(lat);
          setLngNum(lng);
          setStatus(null);
        }}
        onRadius={(r) => setRadiusMeters(r)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={useCurrentLocation}
          disabled={locating}
        >
          {locating ? 'Locating…' : 'Use my current location'}
        </Button>

        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-brand transition-colors">
            Advanced — enter coordinates
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Latitude</label>
              <input
                type="number"
                step="any"
                value={latNum ?? ''}
                placeholder="40.7128"
                onChange={(e) => setLatNum(e.target.value === '' ? null : Number(e.target.value))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Longitude</label>
              <input
                type="number"
                step="any"
                value={lngNum ?? ''}
                placeholder="-74.0060"
                onChange={(e) => setLngNum(e.target.value === '' ? null : Number(e.target.value))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Radius (m)</label>
              <input
                type="number"
                min={10}
                step={10}
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(Math.max(10, Number(e.target.value) || 10))}
                className={inputClass}
              />
            </div>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
          />
          Enforce this geofence
        </label>
        <Button type="submit" size="sm" disabled={save.isPending} className="shrink-0">
          {save.isPending ? 'Saving…' : geofence ? 'Update geofence' : 'Save geofence'}
        </Button>
      </div>

      {status && <p className="text-xs text-slate-500">{status}</p>}
    </form>
  );
}