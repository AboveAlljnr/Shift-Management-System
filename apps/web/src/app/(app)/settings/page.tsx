'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import {
  fetchGeofenceConfig,
  fetchMyGeofenceStatus,
  updateGeofenceConfig,
  type MyGeofenceStatus,
} from '@/lib/api/queries';
import { getAuthUser, hasRole, type AuthUser } from '@/lib/auth';

const inputClass =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';

const MODES: { value: 'strict' | 'warning' | 'off'; label: string; description: string }[] = [
  {
    value: 'strict',
    label: 'Strict (recommended)',
    description:
      'Clock-in is rejected when the employee is outside an active branch geofence. Location capture is required. This is the default behavior.',
  },
  {
    value: 'warning',
    label: 'Warning',
    description:
      'Clock-in outside an active geofence is still accepted, but the event is flagged as unverified with a GEOFENCE_OUTSIDE warning for review.',
  },
  {
    value: 'off',
    label: 'Off',
    description:
      'Geofence enforcement is disabled. No location is required at clock-in and no fence is applied.',
  },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const user: AuthUser | null = getAuthUser();
  const isAdmin = useMemo(() => hasRole(user, ['admin', 'owner']), [user]);

  const { data: config, isLoading } = useQuery({
    queryKey: ['geofenceConfig'],
    queryFn: fetchGeofenceConfig,
  });
  const { data: status } = useQuery<MyGeofenceStatus>({
    queryKey: ['myGeofenceStatus'],
    queryFn: fetchMyGeofenceStatus,
  });

  const [mode, setMode] = useState<'strict' | 'warning' | 'off'>('strict');
  const [allowMissingLocation, setAllowMissingLocation] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => updateGeofenceConfig({ mode, allowMissingLocation }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['geofenceConfig'] });
      queryClient.invalidateQueries({ queryKey: ['myGeofenceStatus'] });
      window.setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Unable to save geofence enforcement settings'),
  });

  const effectiveMode: 'strict' | 'warning' | 'off' =
    config?.mode ?? 'strict';
  const effectiveAllowMissing: boolean = config?.allowMissingLocation ?? false;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Company configuration" />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand" />
            <CardTitle className="font-sans">Geofence enforcement</CardTitle>
          </div>
          <CardDescription>
            Control how clock-in is enforced against branch geofences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-slate-200/60" />
          ) : (
            <>
              {mode !== effectiveMode && !isAdmin && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Current configuration: <strong>{effectiveMode.toUpperCase()}</strong>
                </div>
              )}

              {isAdmin ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    {MODES.map((m) => (
                      <label
                        key={m.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                          effectiveMode === m.value
                            ? 'border-brand bg-brand/5'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="geofenceMode"
                          value={m.value}
                          checked={mode === m.value}
                          onChange={() => setMode(m.value)}
                          className="mt-1 accent-brand"
                        />
                        <span>
                          <span className="block text-sm font-semibold text-slate-800">{m.label}</span>
                          <span className="mt-0.5 block text-sm text-slate-500">{m.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={allowMissingLocation}
                      onChange={(e) => setAllowMissingLocation(e.target.checked)}
                      className="accent-brand"
                    />
                    Allow clock-in without location (only relevant in strict/warning mode where permitted)
                  </label>

                  {error && (
                    <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                      {error}
                    </div>
                  )}
                  {saved && (
                    <div className="rounded-lg border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                      Geofence enforcement settings saved.
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={save.isPending || (mode === effectiveMode && allowMissingLocation === effectiveAllowMissing)}
                      onClick={() => save.mutate()}
                    >
                      {save.isPending ? 'Saving…' : 'Save changes'}
                    </Button>
                    {(mode !== effectiveMode || allowMissingLocation !== effectiveAllowMissing) && (
                      <Button variant="secondary" size="sm" onClick={() => { setMode(effectiveMode); setAllowMissingLocation(effectiveAllowMissing); }}>
                        Reset
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 px-4 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">Current enforcement mode</span>
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {effectiveMode.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Only administrators can change geofence enforcement settings.
                  </p>
                </div>
              )}

              {status && (
                <p className="text-xs text-slate-400">
                  Your profile: {status.applicable
                    ? `geofence applies (${status.mode ?? 'strict'}${status.radiusMeters ? `, within ${status.radiusMeters}m` : ''}${status.branchName ? ` at ${status.branchName}` : ''})`
                    : `geofence enforcement does not apply${status.mode === 'off' ? ' (turned off)' : ''}`}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
