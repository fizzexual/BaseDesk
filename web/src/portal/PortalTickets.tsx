import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { usePortal } from './store';
import { playNotification } from './sound';
import { btnPrimary } from './ui';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { cx } from '../components/util';
import type { Ticket } from '../data/types';
import { IconChevronRight, IconInbox, IconPlus, IconSearch, IconTicket } from '../icons';

// All / Open / Solved. Open groups the still-active statuses; Solved groups the
// finished ones, matching how the agent app buckets them.
type Segment = 'all' | 'open' | 'solved';

const isOpen = (t: Ticket) => t.status === 'open' || t.status === 'pending' || t.status === 'on_hold';
const isSolved = (t: Ticket) => t.status === 'solved' || t.status === 'closed';

const VIEWS: { value: Segment; label: string }[] = [
  { value: 'all', label: 'All tickets' },
  { value: 'open', label: 'Open' },
  { value: 'solved', label: 'Solved' },
];

/** One row in the customer's ticket list — a conversation they can jump back into. */
function TicketCard({ ticket, isNew, onOpen }: { ticket: Ticket; isNew: boolean; onOpen: (id: string) => void }) {
  return (
    <li>
      <Link
        to={`/portal/ticket/${ticket.id}`}
        onClick={() => onOpen(ticket.id)}
        className={cx(
          'group flex items-center gap-3.5 rounded-xl border bg-surface p-3.5 transition-all hover:shadow-1',
          isNew ? 'border-blue/50' : 'border-line hover:border-line-2',
        )}
      >
        <span
          className={cx(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            isOpen(ticket) ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-text-3',
          )}
        >
          <IconTicket size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isNew && <span className="size-2 shrink-0 rounded-full bg-blue" aria-hidden />}
            <span className="truncate text-[14px] font-medium">{ticket.subject}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-text-3">#{ticket.number}</span>
            {isNew && <span className="sr-only">New reply</span>}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-text-3">
            {isNew && <span className="font-medium text-blue">New reply · </span>}
            {ticket.lastMessagePreview}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={ticket.status} tooltip />
          <TimeAgo iso={ticket.lastMessageAt} className="text-[12px] text-text-3" />
        </div>
        <IconChevronRight
          size={16}
          className="hidden shrink-0 text-text-3 transition-opacity sm:block sm:opacity-0 sm:group-hover:opacity-100"
        />
      </Link>
    </li>
  );
}

export function PortalTickets() {
  const tickets = usePortal((s) => s.tickets);
  // Tickets that gained a reply while this list was open, shown with a "new" dot
  // until the customer opens them.
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');

  const seenAtRef = useRef<Map<string, string>>(new Map()); // ticket id -> last activity we know of
  const pollingRef = useRef(false); // guards against overlapping polls

  // Live updates: refresh the list every 10s while the tab is visible so statuses
  // and previews stay current. When a ticket's last activity advances (an agent
  // reply — the customer can't post from this screen) flag it and play the chime
  // at most once per cycle. Pauses while hidden and refetches when visible again.
  useEffect(() => {
    const seed = seenAtRef.current;
    for (const t of usePortal.getState().tickets) seed.set(t.id, t.lastMessageAt);

    async function poll() {
      if (pollingRef.current || document.visibilityState === 'hidden') return;
      pollingRef.current = true;
      try {
        await usePortal.getState().refreshTickets();
        const seen = seenAtRef.current;
        const fresh: string[] = [];
        for (const t of usePortal.getState().tickets) {
          const prev = seen.get(t.id);
          if (prev !== undefined && new Date(t.lastMessageAt).getTime() > new Date(prev).getTime()) {
            fresh.push(t.id);
          }
          seen.set(t.id, t.lastMessageAt);
        }
        if (fresh.length > 0) {
          playNotification();
          setNewIds((prev) => new Set([...prev, ...fresh]));
        }
      } catch {
        // Transient failure — keep the current list and retry next tick.
      } finally {
        pollingRef.current = false;
      }
    }

    const interval = setInterval(() => void poll(), 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  function openTicket(id: string) {
    setNewIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  const counts: Record<Segment, number> = {
    all: tickets.length,
    open: tickets.filter(isOpen).length,
    solved: tickets.filter(isSolved).length,
  };
  const q = query.trim().toLowerCase();
  const filtered = tickets.filter((t) => {
    const inSegment =
      segment === 'all' || (segment === 'open' && isOpen(t)) || (segment === 'solved' && isSolved(t));
    if (!inSegment) return false;
    if (q === '') return true;
    return t.subject.toLowerCase().includes(q) || t.lastMessagePreview.toLowerCase().includes(q);
  });

  const empty = tickets.length === 0;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px]">
      {/* Views sidebar — mirrors the docs / ticket structure */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-line lg:flex">
        <div className="border-b border-line p-3">
          <Link to="/portal/new" className={cx(btnPrimary, 'w-full')}>
            <IconPlus size={15} />
            New ticket
          </Link>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">Views</div>
          <ul className="flex flex-col gap-0.5">
            {VIEWS.map((v) => (
              <li key={v.value}>
                <button
                  type="button"
                  onClick={() => setSegment(v.value)}
                  aria-current={segment === v.value ? 'true' : undefined}
                  className={cx(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                    segment === v.value ? 'bg-surface-2 font-medium text-text' : 'text-text-2 hover:bg-surface-2/60 hover:text-text',
                  )}
                >
                  <span>{v.label}</span>
                  <span className="text-[12px] tabular-nums text-text-3">{counts[v.value]}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Main — header bar + scrolling list */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight">Your tickets</h1>
              <p className="mt-0.5 text-[12px] text-text-3">
                {empty
                  ? 'You haven’t opened any tickets yet.'
                  : counts.open > 0
                    ? `${counts.open} open · ${counts.all} total`
                    : `All caught up · ${counts.all} total`}
              </p>
            </div>
            <Link to="/portal/new" className={cx(btnPrimary, 'lg:hidden')}>
              <IconPlus size={15} />
              New
            </Link>
          </div>

          {!empty && (
            <div className="mt-3 flex items-center gap-2">
              <div className="lg:hidden">
                <SegmentedControl
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'open', label: 'Open' },
                    { value: 'solved', label: 'Solved' },
                  ]}
                  value={segment}
                  onChange={setSegment}
                />
              </div>
              <div className="relative flex-1 sm:max-w-xs">
                <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tickets"
                  aria-label="Search tickets"
                  className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-[13px] outline-none placeholder:text-text-3 focus:border-line-2"
                />
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {empty ? (
            <div className="rounded-xl border border-line bg-surface">
              <EmptyState
                icon={IconInbox}
                title="No tickets yet"
                hint="When you open a ticket it will appear here with its latest status and replies."
              />
              <div className="flex justify-center pb-6">
                <Link to="/portal/new" className={btnPrimary}>
                  <IconPlus size={15} />
                  Open your first ticket
                </Link>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface">
              <EmptyState icon={IconSearch} title="No matching tickets" hint="Try a different search or filter." />
            </div>
          ) : (
            <ul className="mx-auto flex max-w-3xl flex-col gap-2.5">
              {filtered.map((t) => (
                <TicketCard key={t.id} ticket={t} isNew={newIds.has(t.id)} onOpen={openTicket} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
