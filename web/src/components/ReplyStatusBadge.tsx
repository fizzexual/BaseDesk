import type { Ticket } from '../data/types';
import { cx } from './util';
import { Tooltip } from './Tooltip';
import { REPLY_INFO } from './badgeInfo';

const RESOLVED = new Set(['solved', 'closed']);

/**
 * Shows whether a ticket is waiting on the team or has already been answered.
 * - "Awaiting reply" (amber): the last customer message has no agent reply after it.
 * - "Replied" (green): the team has responded since the customer last wrote.
 * Hidden on resolved tickets, where the status pill already tells the story.
 * Hovering explains what the state means.
 */
export function ReplyStatusBadge({ ticket, className }: { ticket: Ticket; className?: string }) {
  if (RESOLVED.has(ticket.status)) return null;
  const awaiting = ticket.awaitingReply;
  const info = awaiting ? REPLY_INFO.awaiting : REPLY_INFO.replied;
  return (
    <Tooltip title={info.title} label={info.desc} align="end">
      <span
        className={cx(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium',
          awaiting ? 'bg-amber-bg text-amber' : 'bg-green-bg text-green',
          className,
        )}
      >
        <span
          className={cx('h-1.5 w-1.5 shrink-0 rounded-full', awaiting ? 'bg-amber' : 'bg-green')}
          aria-hidden="true"
        />
        {awaiting ? 'Awaiting reply' : 'Replied'}
      </span>
    </Tooltip>
  );
}
