'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MapPin } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';
import {
  configureBranchGeofence,
  createBranch,
  createDepartment,
  createTeam,
  fetchBranchGeofence,
  fetchBranches,
  fetchDepartments,
  fetchEmploymentTypes,
  fetchPositions,
  fetchTeams,
  type BranchGeofenceInput,
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
      <PageHeader title="Organization" subtitle="Branches, departments, teams and reference data" />

      <div className="flex gap-1 border-b border-slate-200 mb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px cursor-pointer',
              tab === t.id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
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
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition shadow-none';

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
      <Button
        type="submit"
        disabled={busy || !value.trim()}
        className="shrink-0"
      >
        {busy ? 'Saving…' : buttonLabel}
      </Button>
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
      <div className="space-y-4">
        {(branches ?? []).length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Building2 className="h-8 w-8 text-slate-400" />
              <p className="text-sm font-medium text-slate-600">No branches yet. Add your first one.</p>
            </CardContent>
          </Card>
        )}
        {(branches ?? []).map((b) => (
          <Card key={b.id} className="shift-card">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold text-slate-900 font-sans">{b.name}</CardTitle>
                <Badge variant="neutral">{b.code}</Badge>
              </div>
              <CardDescription>{b.timezone}</CardDescription>
            </CardHeader>
            <CardContent>
              <BranchGeofenceForm branchId={b.id} onError={onError} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
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

  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusMeters, setRadiusMeters] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (geofence) {
      setLatitude(String(geofence.latitude));
      setLongitude(String(geofence.longitude));
      setRadiusMeters(String(geofence.radiusMeters));
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
      setLatitude(pos.latitude.toFixed(6));
      setLongitude(pos.longitude.toFixed(6));
      setStatus('Location captured');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not get location');
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const lat = Number(latitude);
    const lng = Number(longitude);
    const radius = Number(radiusMeters);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setStatus('Enter a valid latitude (-90 to 90)');
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setStatus('Enter a valid longitude (-180 to 180)');
      return;
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      setStatus('Enter a positive radius in meters');
      return;
    }
    save.mutate({ latitude: lat, longitude: lng, radiusMeters: radius, isActive });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <MapPin size={14} className="text-brand" />
          Clock-in geofence
        </p>
        {geofence && (
          <Badge variant={geofence.isActive ? 'success' : 'neutral'}>
            {geofence.isActive ? 'Enabled' : 'Disabled'}
          </Badge>
        )}
        {!geofence && (
          <Badge variant="neutral">Not configured</Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Latitude</label>
          <input
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="40.7128"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Longitude</label>
          <input
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="-74.0060"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Radius (meters)</label>
          <input
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(e.target.value)}
            placeholder="100"
            className={inputClass}
          />
        </div>
      </div>

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
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
          />
          Enforce this geofence
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={save.isPending}
          className="shrink-0"
        >
          {save.isPending ? 'Saving…' : geofence ? 'Update geofence' : 'Save geofence'}
        </Button>
      </div>

      {status && <p className="text-xs text-slate-500">{status}</p>}
    </form>
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
          <ul className="divide-y divide-slate-100">
            {(departments ?? []).length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-slate-500">No departments yet.</li>
            )}
            {(departments ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span className="text-sm font-medium text-slate-800">{d.name}</span>
                <span className="text-xs text-slate-400">
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
          <ul className="divide-y divide-slate-100">
            {(teams ?? []).length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-slate-500">No teams yet.</li>
            )}
            {(teams ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span className="text-sm font-medium text-slate-800">{t.name}</span>
                <span className="text-xs text-slate-400">
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
          <CardTitle className="text-base font-bold text-slate-900 font-sans">Positions</CardTitle>
          <CardDescription>Roles employees hold</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(positions ?? []).length === 0 && <p className="text-sm text-slate-500">No positions defined.</p>}
            {(positions ?? []).map((p) => (
              <span key={p.id} className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {p.name}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold text-slate-900 font-sans">Employment types</CardTitle>
          <CardDescription>How people are employed</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(types ?? []).length === 0 && <p className="text-sm text-slate-500">No employment types defined.</p>}
            {(types ?? []).map((t) => (
              <span key={t.id} className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {t.name}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}