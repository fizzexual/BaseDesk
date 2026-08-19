import { useEffect, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact, Ticket, TicketPriority, TicketSla } from '../../data/types';
import { computeTicketSla } from '../../data/sla';
import { classify, scoreText } from '../../data/sentiment';
import { Tooltip } from '../../components/Tooltip';
import { Avatar } from '../../components/Avatar';
import { CategoryPill } from '../../components/CategoryPill';
import { PriorityPill } from '../../components/PriorityPill';
import { SlaBadge } from '../../components/SlaBadge';
import { ReplyStatusBadge } from '../../components/ReplyStatusBadge';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconNote } from '../../icons';

/**
 * Only surface SLA in the list for the most actionable case — an unanswered
 * ticket whose first-response clock is amber or red. Responded tickets keep
 * their resolution SLA in the ticket header, not the list, so rows stay calm.
 */
export function alertSla(sla: TicketSla | null): TicketSla | null {
  return sla !== null && sla.clock === 'first_response' && (sla.state === 'breached' || sla.state === 'due_soon')
    ? sla
    : null;
}

/**
 * Column templates.
 *
 * The customer column carries a hard min width while subject is `minmax(0, …)`, so
 * subject absorbs every pixel of shortfall and collapses to zero first: at a 607px pane
 * the grid resolved to `34px 200px 0px 150px 128px`, leaving the subject unreadable and
 * its header label painting across Priority. Below the breakpoint we drop the customer
 * column instead — the requester still reads from the row avatar and subject gets the room.
 *
 * These are *container* queries, not viewport ones: the list pane narrows again when a
 * ticket is open, so a viewport breakpoint would miss the case that actually hurts.
 */
// Written out in full rather than composed from a variable: Tailwind scans source text
// for class names and cannot see one that is assembled at runtime.
const GRID_FULL =
  'grid-cols-[minmax(0,2.4fr)_150px_128px] @[640px]:grid-cols-[minmax(220px,1.2fr)_minmax(0,2.4fr)_150px_128px]';
const GRID_NO_CUSTOMER = 'grid-cols-[minmax(0,2.4fr)_150px_128px]';
const GRID_FULL_SELECTABLE =
  'grid-cols-[34px_minmax(0,2.4fr)_150px_128px] @[640px]:grid-cols-[34px_minmax(200px,1.2fr)_minmax(0,2.4fr)_150px_128px]';
const GRID_NO_CUSTOMER_SELECTABLE = 'grid-cols-[34px_minmax(0,2.4fr)_150px_128px]';

export function TicketTable({
  tickets,
  hideCustomer = false,
  selectedId = null,
  onRowContextMenu,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  allSelected = false,
}: {
  tickets: Ticket[];
  hideCustomer?: boolean;
  /** Keyboard-selected row: highlighted and kept scrolled into view. */
  selectedId?: string | null;
  onRowContextMenu?: (e: MouseEvent, ticket: Ticket) => void;
  /** When provided, rows show a bulk-select checkbox. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: () => void;
  allSelected?: boolean;
}) {
  const navigate = useNavigate();
  const contacts = useApp((s) => s.contacts);
  const patchTicket = useApp((s) => s.patchTicket);
  const slaTargets = useApp((s) => s.sla);
  const slaHours = useApp((s) => s.slaHours);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const nowMs = Date.now();

  useEffect(() => {
    if (selectedId !== null) {
      rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedId]);

  const selectable = onToggleSelect !== undefined;
  const grid = selectable
    ? hideCustomer
      ? GRID_NO_CUSTOMER_SELECTABLE
      : GRID_FULL_SELECTABLE
    : hideCustomer
      ? GRID_NO_CUSTOMER
      : GRID_FULL;

  function setPriority(ticket: Ticket, priority: TicketPriority) {
    if (priority === ticket.priority) return;
    patchTicket(ticket.id, { priority }).catch(() => toast('Could not update priority'));
  }

  return (
    // `@container` makes the column rules above respond to this pane's own width.
    <div className="@container">
      <div
        className={cx(
          'sticky top-0 z-10 grid h-9 items-center gap-4 border-b border-line bg-surface px-4 text-[13px] text-text-3',
          grid,
        )}
      >
        {selectable && (
          <div onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              aria-label="Select all tickets"
              checked={allSelected}
              onChange={onToggleAll}
              className="size-4 cursor-pointer accent-green"
            />
          </div>
        )}
        {!hideCustomer && <div className="hidden truncate @[640px]:block">Customer</div>}
        <div className="truncate">Subject</div>
        <div className="truncate">Priority</div>
        <div />
      </div>
      {tickets.map((t) => {
        const contact = contacts[t.requesterId] as Contact | undefined;
        const selected = t.id === selectedId;
        const checked = selectedIds?.has(t.id) ?? false;
        const hasPreview = t.lastMessagePreview !== '';
        // One pill per row: an urgent first-response SLA already implies "awaiting",
        // so show it in place of the reply badge; otherwise show the reply state.
        const alert = alertSla(computeTicketSla(t, slaTargets, nowMs, slaHours));
        // Rows that owe the customer a reply get an amber left stripe so they're
        // easy to spot at a glance; it layers over the keyboard-selection stripe.
        const needsReply = t.awaitingReply && t.status !== 'solved' && t.status !== 'closed';
        // Flag a waiting customer whose latest message reads as frustrated.
        const frustrated = needsReply && hasPreview && classify(scoreText(t.lastMessagePreview)) === 'negative';
        const stripes = [
          needsReply ? 'inset 3px 0 0 0 var(--amber)' : '',
          selected ? 'inset 2px 0 0 0 var(--focus)' : '',
        ].filter(Boolean);
        return (
          <div
            key={t.id}
            ref={(el) => {
              if (el) rowRefs.current.set(t.id, el);
              else rowRefs.current.delete(t.id);
            }}
            data-ticket-id={t.id}
            role="button"
            tabIndex={0}
            aria-label={`Ticket: ${t.subject}`}
            className={cx(
              'grid h-16 cursor-pointer items-center gap-4 border-b border-line px-4 last:border-0',
              grid,
              selected || checked ? 'bg-surface-2' : 'hover:bg-surface-2',
            )}
            style={stripes.length > 0 ? { boxShadow: stripes.join(', ') } : undefined}
            onClick={() => navigate(`/ticket/${t.id}`)}
            onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, t) : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`/ticket/${t.id}`);
              }
            }}
          >
            {selectable && (
              <div onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select ticket: ${t.subject}`}
                  checked={checked}
                  onChange={() => onToggleSelect?.(t.id)}
                  className="size-4 cursor-pointer accent-green"
                />
              </div>
            )}
            {!hideCustomer && (
              <div className="hidden min-w-0 items-center gap-3 @[640px]:flex">
                <Avatar name={contact?.name ?? '?'} hue={contact?.avatarHue ?? 0} size={32} />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium">
                    {contact?.name ?? 'Unknown contact'}
                  </div>
                  <div className="truncate text-[13px] text-text-3">{contact?.email ?? ''}</div>
                </div>
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium">{t.subject}</span>
                {frustrated && (
                  <Tooltip label="This customer sounds frustrated — worth a quick, careful reply.">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: 'var(--red)' }} />
                  </Tooltip>
                )}
                {!hasPreview && <IconNote size={13} className="shrink-0 text-text-3" />}
                <CategoryPill category={t.category} className="shrink-0" />
              </div>
              {hasPreview && (
                <div className="truncate text-[13px] text-text-3">{t.lastMessagePreview}</div>
              )}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <PriorityPill priority={t.priority} onSelect={(p) => setPriority(t, p)} />
            </div>
            <div className="flex flex-col items-end gap-1">
              <TimeAgo iso={t.lastMessageAt} />
              {alert ? <SlaBadge sla={alert} /> : <ReplyStatusBadge ticket={t} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
