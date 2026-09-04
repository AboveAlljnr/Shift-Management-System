import { cn } from '@/lib/utils';

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
  xl: 'w-14 h-14 text-lg',
};

export function Avatar({
  initials,
  color,
  size = 'md',
  className,
}: {
  initials: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  return (
    <div
      className={cn(
        `${sizes[size]} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`,
        className,
      )}
      style={{ background: color || 'hsl(232 79% 57%)' }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
