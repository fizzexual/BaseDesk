import { useEffect, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact, Ticket, TicketPriority } from '../../data/types';
import { computeTicketSla } from '../../data/sla';
import { Avatar } from '../../components/Avatar';
import { CategoryPill } from '../../components/CategoryPill';
import { PriorityPill } from '../../components/PriorityPill';
import { SlaBadge } from '../../components/SlaBadge';
import { ReplyStatusBadge } from '../../components/ReplyStatusBadge';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { alertSla } from './TicketTable';

export function TicketCards({
  tickets,
  selectedId = null,
  onRowContextMenu,
}: {
  tickets: Ticket[];
  selectedId?: string | null;
  onRowContextMenu?: (e: MouseEvent, ticket: Ticket) => void;
}) {
  const navigate = useNavigate();
  const contacts = useApp((s) => s.contacts);
  const patchTicket = useApp((s) => s.patchTicket);
  const slaTargets = useApp((s) => s.sla);
  const slaHours = useApp((s) => s.slaHours);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const nowMs = Date.now();

  useEffect(() => {
    if (selectedId !== null) cardRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  function setPriority(ticket: Ticket, priority: TicketPriority) {
    if (priority === ticket.priority) return;
    patchTicket(ticket.id, { priority }).catch(() => toast('Could not update priority'));
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3 p-4">
      {tickets.map((t) => {
        const contact = contacts[t.requesterId] as Contact | undefined;
        const selected = t.id === selectedId;
        // One pill per card: prefer the urgent SLA alert, else the reply state.
        const alert = alertSla(computeTicketSla(t, slaTargets, nowMs, slaHours));
        // Amber left stripe on cards that owe the customer a reply — easy to spot.
        const needsReply = t.awaitingReply && t.status !== 'solved' && t.status !== 'closed';
        const shadows = [
          needsReply ? 'inset 3px 0 0 0 var(--amber)' : '',
          selected ? 'inset 0 0 0 1.5px var(--focus)' : '',
        ].filter(Boolean);
        return (
          <div
            key={t.id}
            ref={(el) => {
              if (el) cardRefs.current.set(t.id, el);
              else cardRefs.current.delete(t.id);
            }}
            data-ticket-id={t.id}
            role="button"
            tabIndex={0}
            aria-label={`Ticket: ${t.subject}`}
            className={cx(
              'flex cursor-pointer flex-col rounded-md border bg-surface p-3.5 transition-colors',
              selected ? 'border-transparent bg-surface-2' : 'border-line hover:border-line-2',
            )}
            style={shadows.length > 0 ? { boxShadow: shadows.join(', ') } : undefined}
            onClick={() => navigate(`/ticket/${t.id}`)}
            onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, t) : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`/ticket/${t.id}`);
              }
            }}
          >
            <div className="flex items-center gap-2.5">
              <Avatar name={contact?.name ?? '?'} hue={contact?.avatarHue ?? 0} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{contact?.name ?? 'Unknown contact'}</div>
                <div className="truncate text-[13px] text-text-3">{contact?.email ?? ''}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <TimeAgo iso={t.lastMessageAt} />
                {alert ? <SlaBadge sla={alert} /> : <ReplyStatusBadge ticket={t} />}
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{t.subject}</span>
              <CategoryPill category={t.category} className="shrink-0" />
            </div>
            {t.lastMessagePreview !== '' && (
              <p className="mt-1 line-clamp-2 text-[13px] text-text-3">{t.lastMessagePreview}</p>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                <PriorityPill priority={t.priority} onSelect={(p) => setPriority(t, p)} />
              </div>
              {t.tags.length > 0 && (
                <div className="flex min-w-0 items-center gap-1">
                  {t.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="truncate rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-2">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
