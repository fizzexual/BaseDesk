import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { repo } from '../../data';
import { useApp } from '../../data/store';
import { describeTicketEvent } from '../ticket/eventText';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { TimeAgo } from '../../components/TimeAgo';
import { cx } from '../../components/util';
import type { Agent, AuditEvent, TicketEventKind } from '../../data/types';
import { IconHistory, IconSearch } from '../../icons';

const KIND_META: Record<TicketEventKind, { label: string; color: string }> = {
  created: { label: 'Created', color: 'var(--green)' },
  status: { label: 'Status', color: 'var(--blue)' },
  priority: { label: 'Priority', color: 'var(--amber)' },
  assignee: { label: 'Assignment', color: 'var(--blue)' },
  tags: { label: 'Tags', color: 'var(--gray-dot)' },
  merged: { label: 'Merge', color: 'var(--text-3)' },
  link: { label: 'Link', color: 'var(--blue)' },
  split: { label: 'Split', color: 'var(--amber)' },
};
const KINDS = Object.keys(KIND_META) as TicketEventKind[];

const AUTOMATION = 'automation';

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function AuditPage() {
  const agents = useApp((s) => s.agents);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | TicketEventKind>('all');
  const [actor, setActor] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    repo.getAuditLog(1000).then(
      (rows) => {
        if (!cancelled) setEvents(rows);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const actorLabel = (e: AuditEvent): string =>
    e.actorName ?? (e.actorId !== null ? agents[e.actorId]?.name : null) ?? 'Automation';

  // Actors that actually appear in the log, for the filter dropdown.
  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events ?? []) {
      if (e.actorId !== null) seen.set(e.actorId, actorLabel(e));
      else seen.set(AUTOMATION, 'Automation');
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, agents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (events ?? []).filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false;
      if (actor !== 'all') {
        if (actor === AUTOMATION ? e.actorId !== null : e.actorId !== actor) return false;
      }
      if (q !== '') {
        const hay = `${actorLabel(e)} ${describeTicketEvent(e, agents)} #${e.ticketNumber} ${e.ticketSubject}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, query, kind, actor, agents]);

  // Group the filtered feed into day sections (it's already newest-first).
  const groups = useMemo(() => {
    const out: { label: string; items: AuditEvent[] }[] = [];
    for (const e of filtered) {
      const label = dayLabel(e.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-line px-5 py-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[15px] font-semibold text-text">Audit log</h1>
          <span className="text-[13px] text-text-3">Every change your team makes, across all tickets</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search activity…"
              aria-label="Search activity"
              className="h-8 w-64 rounded-md border border-line bg-bg pl-8 pr-2 text-[13px] outline-none placeholder:text-text-3 focus:border-line-2"
            />
          </div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'all' | TicketEventKind)}
            aria-label="Filter by action"
            className="h-8 rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus:border-line-2"
          >
            <option value="all">All actions</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            aria-label="Filter by person"
            className="h-8 rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus:border-line-2"
          >
            <option value="all">Everyone</option>
            {actorOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {events !== null && (
            <span className="ml-auto text-[12px] tabular-nums text-text-3">
              {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {failed ? (
          <EmptyState icon={<IconHistory size={28} />} title="Audit log unavailable" hint="Activity could not be loaded. Refresh to try again." />
        ) : events === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<IconHistory size={28} />}
            title={events.length === 0 ? 'No activity yet' : 'No matching activity'}
            hint={
              events.length === 0
                ? 'Status changes, assignments, tags, merges and links will show up here as your team works.'
                : 'Try a different search or clear the filters.'
            }
          />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {groups.map((g) => (
              <section key={g.label}>
                <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">{g.label}</h2>
                <ul className="flex flex-col">
                  {g.items.map((e) => (
                    <AuditRow key={e.id} event={e} actorName={actorLabel(e)} agents={agents} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AuditRow({
  event,
  actorName,
  agents,
}: {
  event: AuditEvent;
  actorName: string;
  agents: Record<string, Agent>;
}) {
  const meta = KIND_META[event.kind];
  const hue = event.actorId !== null ? agents[event.actorId]?.avatarHue ?? 220 : 220;
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} title={meta.label} />
      <Avatar name={actorName} hue={hue} size={26} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-text-2">
          <span className="font-medium text-text">{actorName}</span> {describeTicketEvent(event, agents)}
        </p>
        <Link
          to={`/ticket/${event.ticketId}`}
          className="block truncate text-[12px] text-text-3 transition-colors hover:text-accent"
        >
          <span className="tabular-nums">#{event.ticketNumber}</span> {event.ticketSubject}
        </Link>
      </div>
      <span className={cx('shrink-0 text-[12px] tabular-nums text-text-3')}>
        <TimeAgo iso={event.at} />
      </span>
    </li>
  );
}
