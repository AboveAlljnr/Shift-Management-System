import * as React from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'brand'
  | 'draft'
  | 'conflict'
  | 'understaffed';

const styles: Record<BadgeVariant, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  brand: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  conflict: 'bg-red-50 text-red-700 border-red-200',
  understaffed: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function Badge({
  variant = 'neutral',
  children,
  className,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border',
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
