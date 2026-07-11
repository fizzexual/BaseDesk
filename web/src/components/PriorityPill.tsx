import type { ReactNode } from 'react';
import { IconArrowDown, IconArrowUp, IconChevronDown, IconChevronsUp } from '../icons';
import { Menu } from './Menu';
import { cx } from './util';

/** Mirrors TicketPriority in web/src/data/types.ts (structurally identical). */
type TicketPriority = 'urgent' | 'high' | 'medium' | 'low';

const ORDER: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];

const LABELS: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function priorityIcon(priority: TicketPriority): ReactNode {
  switch (priority) {
    case 'urgent':
      return <IconChevronsUp size={14} className="shrink-0 text-red" />;
    case 'high':
      return <IconArrowUp size={14} className="shrink-0 text-red" />;
    case 'medium':
      return (
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-dot" />
        </span>
      );
    case 'low':
      return <IconArrowDown size={14} className="shrink-0 text-green" />;
  }
}

export function PriorityPill({
  priority,
  onSelect,
}: {
  priority: TicketPriority;
  onSelect?: (p: TicketPriority) => void;
}) {
  const content = (
    <>
      {priorityIcon(priority)}
      <span>{LABELS[priority]}</span>
    </>
  );

  if (!onSelect) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">{content}</span>
    );
  }

  return (
    <Menu
      align="start"
      triggerLabel={`Priority: ${LABELS[priority]}`}
      triggerClassName="group inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[13px] font-medium hover:border-line hover:bg-surface-2"
      trigger={(open) => (
        <>
          {content}
          <IconChevronDown
            size={12}
            className={cx(
              'shrink-0 text-text-3 transition-opacity',
              open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          />
        </>
      )}
      items={ORDER.map((p) => ({
        label: LABELS[p],
        icon: priorityIcon(p),
        checked: p === priority,
        onSelect: () => onSelect(p),
      }))}
    />
  );
}
