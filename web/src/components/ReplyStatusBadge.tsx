import type { Ticket } from '../data/types';
import { cx } from './util';

const RESOLVED = new Set(['solved', 'closed']);

/**
 * Shows whether a ticket is waiting on the team or has already been answered.
 * - "Awaiting reply" (amber): the last customer message has no agent reply after it.
 * - "Replied" (green): the team has responded since the customer last wrote.
 * Hidden on resolved tickets, where the status pill already tells the story.
 */
export function ReplyStatusBadge({ ticket, className }: { ticket: Ticket; className?: string }) {
  if (RESOLVED.has(ticket.status)) return null;
  const awaiting = ticket.awaitingReply;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 text-[12px] font-medium',
        awaiting ? 'text-amber' : 'text-text-3',
        className,
      )}
      title={awaiting ? 'Customer is waiting for a reply' : 'The team has replied to this thread'}
    >
      <span
        className={cx('h-1.5 w-1.5 shrink-0 rounded-full', awaiting ? 'bg-amber' : 'bg-green')}
        aria-hidden="true"
      />
      {awaiting ? 'Awaiting reply' : 'Replied'}
    </span>
  );
}
