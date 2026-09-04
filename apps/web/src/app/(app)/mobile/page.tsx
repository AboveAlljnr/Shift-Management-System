'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';
import { MapPin, Clock, AlertTriangle, CheckCircle2, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  fetchEmployeeAttendance,
  fetchMyEmployee,
  fetchMyGeofenceStatus,
  fetchMyPresenceVerification,
  fetchMyShifts,
  recordClockEvent,
  verifyPresence,
  type MyGeofenceStatus,
  type MyPresenceVerification,
} from '@/lib/api/queries';
import { cn, formatTime } from '@/lib/utils';
import { format } from 'date-fns';

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

function getLocationErrorMessage(error: unknown): string {
  if (error instanceof GeolocationPositionError) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return 'Location access was denied. Allow location to clock in.';
      case error.POSITION_UNAVAILABLE:
        return 'Your location could not be determined right now.';
      case error.TIMEOUT:
        return 'Location request timed out. Try again.';
      default:
        return 'Unable to determine your location.';
    }
  }
  return error instanceof Error ? error.message : 'Unable to determine your location.';
}

interface ClockErrorBody {
  message?: string;
  errors?: Array<{ code?: string; message?: string }>;
}

function extractClockError(error: unknown): string {
  const ax = error as AxiosError<ClockErrorBody>;
  const data = ax?.response?.data;
  const first = data?.errors?.[0];
  if (first?.code === 'GEOFENCE_OUTSIDE') {
    return first.message ?? data?.message ?? 'You are outside the allowed clock-in area.';
  }
  if (axios.isAxiosError(error) && data?.message) return data.message;
  return 'Unable to record time. Try again.';
}

type GeoStatus = 'checking' | 'valid' | 'invalid' | 'permission-denied' | 'unsupported';

export default function MobilePage() {
  const queryClient = useQueryClient();
  const todayISO = new Date().toISOString().slice(0, 10);
  const [locating, setLocating] = useState(false);
  const [clockNotice, setClockNotice] = useState<string | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('checking');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  const { data: me } = useQuery({ queryKey: ['myEmployee'], queryFn: fetchMyEmployee });
  const myEmployeeId = me?.id;

  const { data: attendance } = useQuery({
    queryKey: ['attendance', 'me', myEmployeeId],
    queryFn: () => fetchEmployeeAttendance(myEmployeeId as string),
    enabled: !!myEmployeeId,
  });

  const { data: myShifts } = useQuery({
    queryKey: ['shifts', 'my', myEmployeeId],
    queryFn: () => fetchMyShifts(myEmployeeId as string),
    enabled: !!myEmployeeId,
    staleTime: 60 * 1000,
  });

  const { data: geofenceStatus } = useQuery({
    queryKey: ['attendance', 'me', 'geofence'],
    queryFn: fetchMyGeofenceStatus,
    staleTime: 60 * 1000,
  });

  const { data: presence } = useQuery<MyPresenceVerification>({
    queryKey: ['myPresenceVerification'],
    queryFn: fetchMyPresenceVerification,
    refetchInterval: 60 * 1000,
  });
  const [verifying, setVerifying] = useState(false);
  const [presenceNotice, setPresenceNotice] = useState<string | null>(null);

  const todaysShift = myShifts?.find((s) => s.startAt.slice(0, 10) === todayISO);
  const todaysAttendance = attendance?.find((a) => a.workDate.slice(0, 10) === todayISO);
  const isClockedIn = !!todaysAttendance?.effectiveClockIn && !todaysAttendance?.effectiveClockOut;

  const presenceVerification = presence?.verification ?? null;
  const presenceDue =
    presenceVerification?.status === 'PENDING' &&
    new Date(presenceVerification.dueAt).getTime() <= Date.now();

  const verifyMutation = useMutation({
    mutationFn: (coords: { latitude: number; longitude: number }) =>
      verifyPresence(presenceVerification?.id as string, coords),
    onSuccess: () => {
      setPresenceNotice('Presence check submitted.');
      queryClient.invalidateQueries({ queryKey: ['myPresenceVerification'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => setPresenceNotice(extractClockError(e)),
    onSettled: () => setVerifying(false),
  });

  const handleVerifyPresence = async () => {
    if (!presenceVerification) return;
    setPresenceNotice(null);
    setVerifying(true);
    try {
      const pos = await getCurrentPosition();
      verifyMutation.mutate({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
    } catch (locErr) {
      setVerifying(false);
      setPresenceNotice(getLocationErrorMessage(locErr));
    }
  };

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
      setClockNotice(isClockedIn ? 'Clock-out recorded' : 'Clock-in recorded');
      queryClient.invalidateQueries({ queryKey: ['attendance', 'me'] });
    },
    onError: (e) => setClockNotice(extractClockError(e)),
    onSettled: () => setLocating(false),
  });

  const handleClock = async () => {
    setClockNotice(null);

    if (isClockedIn) {
      clockMutation.mutate({ eventType: 'clock_out' });
      return;
    }

    if (geofenceStatus?.applicable) {
      setLocating(true);
      setGeoStatus('checking');
      try {
        const pos = await getCurrentPosition();
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPosition({ lat, lng });
        setGeoStatus('valid');
        clockMutation.mutate({
          eventType: 'clock_in',
          latitude: lat,
          longitude: lng,
        });
      } catch (locErr) {
        setLocating(false);
        const msg = getLocationErrorMessage(locErr);
        if (msg.includes('denied')) setGeoStatus('permission-denied');
        else setGeoStatus('invalid');
        setClockNotice(msg);
      }
      return;
    }

    clockMutation.mutate({ eventType: 'clock_in' });
  };

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex flex-col items-center justify-center p-4 sm:p-6 bg-slate-50">
      <div className="w-full max-w-sm space-y-5">
        {/* Header */}
        <div className="text-center">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
            {format(new Date(), 'EEEE, MMMM d')}
          </p>
          <h1 className="text-xl font-bold text-slate-900 mt-1 font-sans">
            {me ? `${me.firstName} ${me.lastName}` : 'Employee'}
          </h1>
        </div>

        {/* Geofence status */}
        <Card className="border border-slate-200/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {geofenceStatus?.applicable ? (
                <>
                  <div className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    geoStatus === 'valid' ? 'bg-emerald-100' : geoStatus === 'permission-denied' ? 'bg-red-100' : 'bg-slate-100'
                  )}>
                    {geoStatus === 'valid' ? (
                      <CheckCircle2 size={20} className="text-emerald-600" />
                    ) : geoStatus === 'permission-denied' ? (
                      <WifiOff size={20} className="text-red-500" />
                    ) : (
                      <MapPin size={20} className="text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {geofenceStatus.branchName}
                    </p>
                    <p className="text-xs text-slate-400">
                      Geofence · {Math.round(geofenceStatus.radiusMeters ?? 0)}m radius
                    </p>
                  </div>
                  <div className={cn(
                    'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                    geoStatus === 'valid'
                      ? 'bg-emerald-100 text-emerald-700'
                      : geoStatus === 'permission-denied'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-slate-100 text-slate-500'
                  )}>
                    {geoStatus === 'valid' ? 'Located' : geoStatus === 'permission-denied' ? 'Denied' : 'Pending'}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                    <Clock size={20} className="text-slate-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">No geofence</p>
                    <p className="text-xs text-slate-400">Free clock-in available</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Today's shift */}
        <Card className="bg-sidebar text-white border-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Today&apos;s Shift</span>
              {todaysShift && (
                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full uppercase">
                  Active
                </span>
              )}
            </div>
            <p className="text-base font-bold text-white font-sans">
              {todaysShift ? todaysShift.name : 'No shift assigned'}
            </p>
            {todaysShift && (
              <p className="text-xs text-slate-400 mt-1">
                {formatTime(todaysShift.startAt)} – {formatTime(todaysShift.endAt)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Current status */}
        {todaysAttendance && (
          <Card className="border border-slate-200/80">
            <CardContent className="p-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Current Status</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500">Clock In</p>
                  <p className="text-sm font-semibold text-slate-800 font-mono">
                    {todaysAttendance.effectiveClockIn
                      ? formatTime(todaysAttendance.effectiveClockIn)
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Clock Out</p>
                  <p className="text-sm font-semibold text-slate-800 font-mono">
                    {todaysAttendance.effectiveClockOut
                      ? formatTime(todaysAttendance.effectiveClockOut)
                      : isClockedIn ? 'In progress' : '—'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Presence verification */}
        {presence?.applicable && presenceVerification && (
          <Card
            className={cn(
              'border',
              presenceDue
                ? 'border-brand bg-brand/5'
                : presenceVerification.status === 'OUTSIDE_GEOFENCE' || presenceVerification.status === 'MISSED'
                  ? 'border-red-200'
                  : presenceVerification.status === 'VERIFIED'
                    ? 'border-emerald-200'
                    : 'border-slate-200/80',
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    presenceVerification.status === 'VERIFIED'
                      ? 'bg-emerald-100'
                      : presenceVerification.status === 'OUTSIDE_GEOFENCE' || presenceVerification.status === 'MISSED'
                        ? 'bg-red-100'
                        : presenceDue
                          ? 'bg-brand/10'
                          : 'bg-slate-100',
                  )}
                >
                  {presenceVerification.status === 'VERIFIED' ? (
                    <CheckCircle2 size={20} className="text-emerald-600" />
                  ) : presenceVerification.status === 'OUTSIDE_GEOFENCE' || presenceVerification.status === 'MISSED' ? (
                    <AlertTriangle size={20} className="text-red-500" />
                  ) : (
                    <MapPin size={20} className="text-brand" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Presence Verification
                  </p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5">
                    {presenceVerification.status === 'VERIFIED'
                      ? `Verified at ${presenceVerification.verifiedAt ? formatTime(presenceVerification.verifiedAt) : formatTime(presenceVerification.dueAt)}`
                      : presenceVerification.status === 'OUTSIDE_GEOFENCE'
                        ? 'Outside geofence — flagged for review'
                        : presenceVerification.status === 'MISSED'
                          ? 'Missed — presence check not completed'
                          : presenceDue
                            ? 'Presence Verification Required'
                            : `Presence check scheduled for ${formatTime(presenceVerification.dueAt)}`}
                  </p>
                  {presenceVerification.status === 'PENDING' && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {presenceDue
                        ? 'In-app reminder: verify your presence now.'
                        : 'Location is requested only when you choose Verify Presence.'}
                    </p>
                  )}
                  {presenceVerification.status === 'OUTSIDE_GEOFENCE' && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      Your location was outside the branch area at the scheduled time.
                    </p>
                  )}
                </div>
                {presenceDue && (
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={verifying || verifyMutation.isPending}
                    onClick={handleVerifyPresence}
                  >
                    {verifying ? 'Locating…' : 'Verify Presence'}
                  </Button>
                )}
              </div>
              {presenceNotice && (
                <p className="mt-2 flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle size={13} />
                  {presenceNotice}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Clock button */}
        <div className="space-y-3">
          <Button
            onClick={handleClock}
            disabled={clockMutation.isPending || locating}
            className={cn(
              'w-full py-6 text-base font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all',
              isClockedIn
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-200'
                : 'bg-brand hover:bg-brand-dark text-white shadow-brand/30'
            )}
          >
            {locating ? (
              <span className="flex items-center gap-2">
                <MapPin size={18} className="animate-pulse" />
                Checking location…
              </span>
            ) : clockMutation.isPending ? (
              'Recording…'
            ) : isClockedIn ? (
              'CLOCK OUT'
            ) : (
              'CLOCK IN'
            )}
          </Button>

          {clockNotice && (
            <div className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
              clockNotice.includes('recorded')
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-600 border border-red-200'
            )}>
              {clockNotice.includes('recorded') ? (
                <CheckCircle2 size={16} className="shrink-0" />
              ) : (
                <AlertTriangle size={16} className="shrink-0" />
              )}
              {clockNotice}
            </div>
          )}
        </div>

        {/* Debug info (dev only) */}
        {position && process.env.NODE_ENV === 'development' && (
          <p className="text-[10px] text-slate-300 text-center">
            lat {position.lat.toFixed(6)}, lng {position.lng.toFixed(6)}
          </p>
        )}
      </div>
    </div>
  );
}
