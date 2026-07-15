import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import { StatusBadge } from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import type { Ticket, TicketLinkType } from '../../data/types';
import { IconPlus, IconX } from '../../icons';

const LINK_LABEL: Record<TicketLinkType, string> = {
  related: 'Related to',
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  duplicate_of: 'Duplicate of',
  duplicated_by: 'Duplicated by',
};
// Types an agent picks when adding a link (phrased from this ticket).
const ADD_TYPES: { value: TicketLinkType; label: string }[] = [
  { value: 'related', label: 'Related to' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'blocked_by', label: 'Blocked by' },
  { value: 'duplicate_of', label: 'Duplicate of' },
];

/** Typed links to other tickets — related / blocks / blocked by / duplicate of. */
export function TicketLinks({ ticket }: { ticket: Ticket }) {
  const links = useApp((s) => s.ticketLinks[ticket.id]) ?? [];
  const addLink = useApp((s) => s.addLink);
  const removeLink = useApp((s) => s.removeLink);
  const searchLocal = useApp((s) => s.searchLocal);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<TicketLinkType>('related');
  const [query, setQuery] = useState('');

  const excluded = useMemo(() => new Set([ticket.id, ...links.map((l) => l.ticketId)]), [links, ticket.id]);
  const results = query.trim() === '' ? [] : searchLocal(query).filter((t) => !excluded.has(t.id)).slice(0, 5);

  async function add(other: Ticket) {
    try {
      await addLink(ticket.id, other.id, type);
      setQuery('');
      setAdding(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not link the ticket');
    }
  }

  return (
    <section className="border-t border-line p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-3">
          <Tooltip title="Linked tickets" label="Connect this ticket to others — flag duplicates and blockers, or just group related work.">
            <span>Linked tickets</span>
          </Tooltip>
        </h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className={cx(
            'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium transition-colors',
            adding ? 'text-accent hover:bg-surface-2' : 'text-text-2 hover:bg-surface-2 hover:text-text',
          )}
        >
          <IconPlus size={13} />
          Link
        </button>
      </div>

      {adding && (
        <div className="mb-3 rounded-md border border-line bg-surface-2/40 p-2">
          <div className="flex gap-1.5">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TicketLinkType)}
              aria-label="Link type"
              className="h-8 shrink-0 rounded-md border border-line bg-bg px-1.5 text-[12px] outline-none focus:border-line-2"
            >
              {ADD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a ticket…"
              aria-label="Search tickets to link"
              autoFocus
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-[12px] outline-none placeholder:text-text-3 focus:border-line-2"
            />
          </div>
          {query.trim() !== '' && results.length === 0 && <p className="mt-1.5 px-1 text-[12px] text-text-3">No matching tickets.</p>}
          {results.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {results.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void add(t)}
                    className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="shrink-0 text-[11px] tabular-nums text-text-3">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px]">{t.subject}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-[13px] text-text-3">No linked tickets.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((l) => (
            <li key={l.linkId} className="group flex items-center gap-2">
              <span className="w-[72px] shrink-0 text-[11px] font-medium uppercase tracking-wide text-text-3">{LINK_LABEL[l.type]}</span>
              <Link to={`/ticket/${l.ticketId}`} className="min-w-0 flex-1 truncate text-[13px] transition-colors hover:text-accent">
                <span className="text-text-3">#{l.number}</span> {l.subject}
              </Link>
              <StatusBadge status={l.status} />
              <button
                type="button"
                aria-label="Remove link"
                onClick={() => void removeLink(ticket.id, l.linkId).catch(() => toast('Could not remove the link'))}
                className="shrink-0 rounded-sm p-0.5 text-text-3 opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100"
              >
                <IconX size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
