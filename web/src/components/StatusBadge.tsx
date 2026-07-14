import type { ComponentType } from 'react';
import { IconCheck, IconCheckCircle, IconCircle, IconClock, IconPause } from '../icons';
import { cx } from './util';
import { Tooltip } from './Tooltip';
import { STATUS_INFO } from './badgeInfo';

/** Mirrors TicketStatus in web/src/data/types.ts (structurally identical). */
type TicketStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

const CONFIG: Record<TicketStatus, { label: string; Icon: IconComponent; className: string }> = {
  open: { label: 'Open', Icon: IconCircle, className: 'bg-blue-bg text-blue' },
  pending: { label: 'Pending', Icon: IconClock, className: 'bg-amber-bg text-amber' },
  on_hold: { label: 'On hold', Icon: IconPause, className: 'bg-surface-3 text-text-2' },
  solved: { label: 'Solved', Icon: IconCheck, className: 'bg-green-bg text-green' },
  closed: { label: 'Closed', Icon: IconCheckCircle, className: 'bg-surface-2 text-text-3' },
};

export function StatusBadge({ status, tooltip = false }: { status: TicketStatus; tooltip?: boolean }) {
  const { label, Icon, className } = CONFIG[status];
  const badge = (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium',
        className,
      )}
    >
      <Icon size={12} className="shrink-0" />
      {label}
    </span>
  );
  if (!tooltip) return badge;
  const info = STATUS_INFO[status];
  return (
    <Tooltip title={info.title} label={info.desc}>
      {badge}
    </Tooltip>
  );
}
