import { cn } from '@/lib/utils';

const STYLES: Record<string, string> = {
  // Neutral / info
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-muted text-muted-foreground',
  review: 'bg-muted text-foreground',
  invited: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-100 text-amber-800',
  verified: 'bg-emerald-100 text-emerald-800',
  outside_geofence: 'bg-amber-100 text-amber-800',
  missed: 'bg-rose-100 text-rose-800',
  // Active / success
  active: 'bg-emerald-100 text-emerald-800',
  present: 'bg-emerald-100 text-emerald-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  approved: 'bg-emerald-100 text-emerald-800',
  published: 'bg-emerald-100 text-emerald-800',
  full_time: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-emerald-100 text-emerald-800',
  // Warning
  warning: 'bg-amber-100 text-amber-800',
  WARNING: 'bg-amber-100 text-amber-800',
  late: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-slate-200 text-slate-700',
  suspended: 'bg-slate-200 text-slate-700',
  // Danger
  blocking: 'bg-rose-100 text-rose-800',
  BLOCKING: 'bg-rose-100 text-rose-800',
  rejected: 'bg-rose-100 text-rose-800',
  absent: 'bg-rose-100 text-rose-800',
  revoked: 'bg-rose-100 text-rose-800',
  terminated: 'bg-rose-100 text-rose-800',
  inactive: 'bg-slate-200 text-slate-700',
  on_leave: 'bg-sky-100 text-sky-800',
  lock: 'bg-slate-200 text-slate-700',
};

const TITLES: Record<string, string> = {
  WARNING: 'Warning',
  BLOCKING: 'Blocking',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const key = status.toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STYLES[key] ?? 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {TITLES[status] ?? status.replace(/_/g, ' ')}
    </span>
  );
}