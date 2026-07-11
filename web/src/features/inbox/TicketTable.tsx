import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact, Ticket, TicketPriority } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { PriorityPill } from '../../components/PriorityPill';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconNote } from '../../icons';

const GRID_FULL = 'grid-cols-[minmax(220px,1.2fr)_minmax(0,2.4fr)_150px_90px]';
const GRID_NO_CUSTOMER = 'grid-cols-[minmax(0,2.4fr)_150px_90px]';

export function TicketTable({
  tickets,
  hideCustomer = false,
  selectedId = null,
}: {
  tickets: Ticket[];
  hideCustomer?: boolean;
  /** Keyboard-selected row: highlighted and kept scrolled into view. */
  selectedId?: string | null;
}) {
  const navigate = useNavigate();
  const contacts = useApp((s) => s.contacts);
  const patchTicket = useApp((s) => s.patchTicket);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (selectedId !== null) {
      rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedId]);

  const grid = hideCustomer ? GRID_NO_CUSTOMER : GRID_FULL;

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
        {!hideCustomer && <div>Customer</div>}
        <div>Subject</div>
        <div>Priority</div>
        <div />
      </div>
      {tickets.map((t) => {
        const contact = contacts[t.requesterId] as Contact | undefined;
        const selected = t.id === selectedId;
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
              selected ? 'bg-surface-2' : 'hover:bg-surface-2',
            )}
            style={selected ? { boxShadow: 'inset 2px 0 0 0 var(--focus)' } : undefined}
            onClick={() => navigate(`/ticket/${t.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`/ticket/${t.id}`);
              }
            }}
          >
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
            <div className="flex justify-end">
              <TimeAgo iso={t.lastMessageAt} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
