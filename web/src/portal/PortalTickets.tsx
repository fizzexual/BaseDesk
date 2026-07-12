import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { usePortal } from './store';
import { playNotification } from './sound';
import { EmptyState } from '../components/EmptyState';
import { SegmentedControl } from '../components/SegmentedControl';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { cx } from '../components/util';
import { IconInbox, IconPlus, IconSearch } from '../icons';
import { btnPrimary } from './ui';

// All / Open / Solved. Open groups the still-active statuses; Solved groups the
// finished ones, matching how the agent app buckets them.
type Segment = 'all' | 'open' | 'solved';

export function PortalTickets() {
  const contact = usePortal((s) => s.contact);
  const tickets = usePortal((s) => s.tickets);
  // Tickets that gained a reply while this list was open, shown with a "new" dot
  // until the customer opens them.
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  // Local view controls over the polled `tickets` array — they never touch the
  // store, so live polling and the "new reply" dot keep working underneath.
  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');

  const seenAtRef = useRef<Map<string, string>>(new Map()); // ticket id -> last activity we know of
  const pollingRef = useRef(false); // guards against overlapping polls

  // Live updates: refresh the list every 10s while the tab is visible so statuses
  // and previews stay current. When a ticket's last activity advances (an agent
  // reply — the customer can't post from this screen) flag it and play the chime
  // at most once per cycle. Pauses while hidden and refetches when visible again.
  useEffect(() => {
    // Seed the baseline from whatever is already loaded so nothing flags on mount.
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

  const q = query.trim().toLowerCase();
  const filtered = tickets.filter((t) => {
    const inSegment =
      segment === 'all' ||
      (segment === 'open' && (t.status === 'open' || t.status === 'pending' || t.status === 'on_hold')) ||
      (segment === 'solved' && (t.status === 'solved' || t.status === 'closed'));
    if (!inSegment) return false;
    if (q === '') return true;
    return t.subject.toLowerCase().includes(q) || t.lastMessagePreview.toLowerCase().includes(q);
  });

  return (
    <section>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold">Your tickets</h1>
          <p className="mt-1 text-[13px] text-text-3">
            {contact ? `Signed in as ${contact.email}` : ''}
          </p>
        </div>
        <Link to="/portal/new" className={btnPrimary}>
          <IconPlus size={15} />
          New ticket
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={IconInbox}
            title="No tickets yet"
            hint="When you open a ticket it will appear here with its latest status."
          />
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl
              options={[
                { value: 'all', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'solved', label: 'Solved' },
              ]}
              value={segment}
              onChange={setSegment}
            />
            <div className="relative sm:w-64">
              <IconSearch
                size={15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
              />
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

          {filtered.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={IconSearch}
                title="No matching tickets"
                hint="Try a different search or filter."
              />
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {filtered.map((t) => {
                const isNew = newIds.has(t.id);
                return (
                  <li key={t.id}>
                    <Link
                      to={`/portal/ticket/${t.id}`}
                      onClick={() => openTicket(t.id)}
                      className={cx(
                        'block rounded-lg border bg-surface p-4 transition-colors hover:border-line-2',
                        isNew ? 'border-blue/40' : 'border-line',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {isNew && <span className="h-2 w-2 shrink-0 rounded-full bg-blue" aria-hidden />}
                            <span className="truncate text-[15px] font-medium">{t.subject}</span>
                            <span className="shrink-0 text-[12px] text-text-3">#{t.number}</span>
                            {isNew && <span className="sr-only">New reply</span>}
                          </div>
                          <p className="mt-1 truncate text-[13px] text-text-3">{t.lastMessagePreview}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <StatusBadge status={t.status} />
                          <TimeAgo iso={t.lastMessageAt} className="text-[12px] text-text-3" />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
