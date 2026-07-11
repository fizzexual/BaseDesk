import type { ReactNode } from 'react';
import { cx } from './util';

type Side = 'top' | 'bottom' | 'left' | 'right';

const SIDE: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
};

export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string;
  children: ReactNode;
  side?: Side;
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-sm bg-accent px-2 py-1 text-[12px] font-medium text-accent-fg opacity-0 shadow-2 transition-opacity duration-100',
          'group-hover:opacity-100 group-hover:delay-300 group-focus-within:opacity-100 group-focus-within:delay-300',
          SIDE[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}
