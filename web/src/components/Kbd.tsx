import type { ReactNode } from 'react';
import { cx } from './util';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'tabular-nums inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line-2 bg-surface-2 px-1.5 font-sans text-[11px] font-medium text-text-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
