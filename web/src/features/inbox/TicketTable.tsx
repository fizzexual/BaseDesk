import { useEffect, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact, Ticket, TicketPriority, TicketSla } from '../../data/types';
import { computeTicketSla } from '../../data/sla';
import { Avatar } from '../../components/Avatar';
import { PriorityPill } from '../../components/PriorityPill';
import { SlaBadge } from '../../components/SlaBadge';
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

const GRID_FULL = 'grid-cols-[minmax(220px,1.2fr)_minmax(0,2.4fr)_150px_90px]';
const GRID_NO_CUSTOMER = 'grid-cols-[minmax(0,2.4fr)_150px_90px]';

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
      ? 'grid-cols-[34px_minmax(0,2.4fr)_150px_90px]'
      : 'grid-cols-[34px_minmax(200px,1.2fr)_minmax(0,2.4fr)_150px_90px]'
    : hideCustomer
      ? GRID_NO_CUSTOMER
      : GRID_FULL;

  function setPriority(ticket: Ticket, priority: TicketPriority) {
    if (priority === ticket.priority) return;
    patchTicket(ticket.id, { priority }).catch(() => toast('Could not update priority'));
  }

  return (
    <div>
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
        {!hideCustomer && <div>Customer</div>}
        <div>Subject</div>
        <div>Priority</div>
        <div />
      </div>
      {tickets.map((t) => {
        const contact = contacts[t.requesterId] as Contact | undefined;
        const selected = t.id === selectedId;
        const checked = selectedIds?.has(t.id) ?? false;
        const hasPreview = t.lastMessagePreview !== '';
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
            style={selected ? { boxShadow: 'inset 2px 0 0 0 var(--focus)' } : undefined}
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
              <div className="flex min-w-0 items-center gap-3">
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
                {!hasPreview && <IconNote size={13} className="shrink-0 text-text-3" />}
              </div>
              {hasPreview && (
                <div className="truncate text-[13px] text-text-3">{t.lastMessagePreview}</div>
              )}
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <PriorityPill priority={t.priority} onSelect={(p) => setPriority(t, p)} />
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <TimeAgo iso={t.lastMessageAt} />
              <SlaBadge sla={alertSla(computeTicketSla(t, slaTargets, nowMs, slaHours))} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
