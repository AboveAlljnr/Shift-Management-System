'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  createBranch,
  createDepartment,
  createTeam,
  fetchBranches,
  fetchDepartments,
  fetchEmploymentTypes,
  fetchPositions,
  fetchTeams,
} from '@/lib/api/queries';

const TABS = [
  { id: 'branches', label: 'Branches' },
  { id: 'departments', label: 'Departments' },
  { id: 'teams', label: 'Teams' },
  { id: 'reference', label: 'Reference data' },
] as const;

export default function OrganizationPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('branches');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organization</h1>
        <p className="text-sm text-muted-foreground">Branches, departments, teams and reference data</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {tab === 'branches' && <BranchesTab onError={setError} />}
      {tab === 'departments' && <DepartmentsTab onError={setError} />}
      {tab === 'teams' && <TeamsTab onError={setError} />}
      {tab === 'reference' && <ReferenceTab />}
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

function InsertBar({
  placeholder,
  buttonLabel,
  onSubmit,
  busy,
}: {
  placeholder: string;
  buttonLabel: string;
  onSubmit: (value: string) => void;
  busy: boolean;
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
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className={inputClass} />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {busy ? 'Saving…' : buttonLabel}
      </button>
    </form>
  );
}

function BranchesTab({ onError }: { onError: (e: string | null) => void }) {
  const queryClient = useQueryClient();
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });

  const create = useMutation({
    mutationFn: (name: string) =>
      createBranch({
        name,
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'BR',
        timezone: 'UTC',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branches'] }),
    onError: (e) => onError(e instanceof Error ? e.message : 'Failed to create branch'),
  });

  return (
    <div className="space-y-4">
      <InsertBar
        placeholder="Branch name (e.g. Downtown)"
        buttonLabel="Add branch"
        onSubmit={(v) => create.mutate(v)}
        busy={create.isPending}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(branches ?? []).length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No branches yet. Add your first one.</p>
            </CardContent>
          </Card>
        )}
        {(branches ?? []).map((b) => (
          <Card key={b.id}>
            <CardHeader>
              <CardTitle>{b.name}</CardTitle>
              <CardDescription>
                {b.code} · {b.timezone}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DepartmentsTab({ onError }: { onError: (e: string | null) => void }) {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });

  const create = useMutation({
    mutationFn: (name: string) =>
      createDepartment({
        branchId: branchId || (branches?.[0]?.id as string),
        name,
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'DEPT',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      onError(null);
    },
    onError: (e) => onError(e instanceof Error ? e.message : 'Failed to create department'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={cn(inputClass, 'max-w-xs')}>
          <option value="">Branch: {branches?.[0]?.name ?? 'first available'}</option>
          {(branches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="min-w-0 flex-1">
          <InsertBar
            placeholder="Department name (e.g. Operations)"
            buttonLabel="Add department"
            onSubmit={(v) => create.mutate(v)}
            busy={create.isPending}
          />
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {(departments ?? []).length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-muted-foreground">No departments yet.</li>
            )}
            {(departments ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span className="text-sm font-medium">{d.name}</span>
                <span className="text-xs text-muted-foreground">
                  {d.code} · {branches?.find((b) => b.id === d.branchId)?.name ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamsTab({ onError }: { onError: (e: string | null) => void }) {
  const queryClient = useQueryClient();
  const [departmentId, setDepartmentId] = useState('');
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: teams } = useQuery({ queryKey: ['teams'], queryFn: fetchTeams });

  const create = useMutation({
    mutationFn: (name: string) =>
      createTeam({
        departmentId: departmentId || (departments?.[0]?.id as string),
        name,
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'TEAM',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      onError(null);
    },
    onError: (e) => onError(e instanceof Error ? e.message : 'Failed to create team'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className={cn(inputClass, 'max-w-xs')}
        >
          <option value="">Department: {departments?.[0]?.name ?? 'first available'}</option>
          {(departments ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="min-w-0 flex-1">
          <InsertBar
            placeholder="Team name (e.g. Night Shift)"
            buttonLabel="Add team"
            onSubmit={(v) => create.mutate(v)}
            busy={create.isPending}
          />
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {(teams ?? []).length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-muted-foreground">No teams yet.</li>
            )}
            {(teams ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.code} · {departments?.find((d) => d.id === t.departmentId)?.name ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ReferenceTab() {
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: fetchPositions });
  const { data: types } = useQuery({ queryKey: ['employment-types'], queryFn: fetchEmploymentTypes });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Positions</CardTitle>
          <CardDescription>Roles employees hold</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(positions ?? []).length === 0 && <p className="text-sm text-muted-foreground">No positions defined.</p>}
            {(positions ?? []).map((p) => (
              <span key={p.id} className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
                {p.name}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Employment types</CardTitle>
          <CardDescription>How people are employed</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(types ?? []).length === 0 && <p className="text-sm text-muted-foreground">No employment types defined.</p>}
            {(types ?? []).map((t) => (
              <span key={t.id} className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
                {t.name}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}