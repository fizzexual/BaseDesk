import type { SlaState, TicketSla } from '../data/types';
import { cx } from './util';

const PILL: Record<SlaState, string> = {
  breached: 'bg-red-bg text-red',
  due_soon: 'bg-amber-bg text-amber',
  on_track: 'bg-surface-2 text-text-3',
  paused: 'bg-surface-2 text-text-3',
  met: 'bg-green-bg text-green',
};
const DOT: Record<SlaState, string> = {
  breached: 'bg-red',
  due_soon: 'bg-amber',
  on_track: 'bg-gray-dot',
  paused: 'bg-gray-dot',
  met: 'bg-green',
};

/** Compact SLA pill: a colored dot + label ("Reply overdue", "Reply due in 25m", "Met"). */
export function SlaBadge({ sla, className }: { sla: TicketSla | null; className?: string }) {
  if (sla === null) return null;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium',
        PILL[sla.state],
        className,
      )}
      title={`SLA: ${sla.label}`}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[sla.state])} aria-hidden="true" />
      {sla.label}
    </span>
  );
}
