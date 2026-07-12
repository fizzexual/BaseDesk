import type { SlaState, TicketSla } from '../data/types';
import { cx } from './util';

const TEXT: Record<SlaState, string> = {
  breached: 'text-red',
  due_soon: 'text-amber',
  on_track: 'text-text-3',
  paused: 'text-text-3',
  met: 'text-green',
};
const DOT: Record<SlaState, string> = {
  breached: 'bg-red',
  due_soon: 'bg-amber',
  on_track: 'bg-gray-dot',
  paused: 'bg-gray-dot',
  met: 'bg-green',
};

/** Compact SLA indicator: a colored dot + label ("Reply due in 25m", "Overdue", "Met"). */
export function SlaBadge({ sla, className }: { sla: TicketSla | null; className?: string }) {
  if (sla === null) return null;
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 text-[12px] font-medium', TEXT[sla.state], className)}
      title={`SLA: ${sla.label}`}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[sla.state])} aria-hidden="true" />
      {sla.label}
    </span>
  );
}
