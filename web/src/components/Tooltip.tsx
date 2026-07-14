import type { ReactNode } from 'react';
import { cx } from './util';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'center' | 'start' | 'end';

/** Position classes for the floating bubble, given a side and (for top/bottom) a horizontal alignment. */
function position(side: Side, align: Align): string {
  if (side === 'left') return 'right-full top-1/2 mr-1.5 -translate-y-1/2';
  if (side === 'right') return 'left-full top-1/2 ml-1.5 -translate-y-1/2';
  const vertical = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  const horizontal = align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'start' ? 'left-0' : 'right-0';
  return `${vertical} ${horizontal}`;
}

/**
 * Hover/focus tooltip. Two shapes:
 * - Plain: a short accent pill (pass just `label`), e.g. an icon button's name.
 * - Rich: a titled explainer card (pass `title` + a longer `label`), e.g. what a
 *   "Pending" status or an SLA badge means. Use `align="end"` for triggers near
 *   the right edge so the wider card doesn't overflow the viewport.
 */
export function Tooltip({
  label,
  title,
  children,
  side = 'top',
  align = 'center',
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode;
  side?: Side;
  align?: Align;
}) {
  const rich = title !== undefined;
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute z-50 opacity-0 shadow-2 transition-opacity duration-100',
          'group-hover:opacity-100 group-hover:delay-300 group-focus-within:opacity-100 group-focus-within:delay-300',
          rich
            ? 'w-max max-w-[248px] whitespace-normal rounded-md border border-line bg-surface px-2.5 py-2 text-left'
            : 'whitespace-nowrap rounded-sm bg-accent px-2 py-1 text-[12px] font-medium text-accent-fg',
          position(side, align),
        )}
      >
        {rich ? (
          <>
            <span className="block text-[12px] font-semibold text-text">{title}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-text-2">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
    </span>
  );
}
