import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { Agent, Contact, Ticket } from '../../data/types';
import { Leaderboard } from './Leaderboard';
import { Avatar } from '../../components/Avatar';
import { CategoryPill } from '../../components/CategoryPill';
import { EmptyState } from '../../components/EmptyState';
import { Menu, type MenuItem } from '../../components/Menu';
import { PriorityPill } from '../../components/PriorityPill';
import { ReplyStatusBadge } from '../../components/ReplyStatusBadge';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconAlert, IconChevronDown, IconInbox, IconSearch, IconTeam, IconUser, IconUserPlus, IconX } from '../../icons';

type Sort = 'busy' | 'awaiting' | 'name';
const SORT_LABEL: Record<Sort, string> = { busy: 'Busiest', awaiting: 'Needs reply', name: 'Name' };

// A ticket is part of a member's live workload when it's unresolved and in the inbox
// (open/pending/on-hold — solved and closed are done, so they don't count as active load).
function isActive(t: Ticket): boolean {
  return t.bucket === 'inbox' && (t.status === 'open' || t.status === 'pending' || t.status === 'on_hold');
}
// A live ticket the customer is waiting on — the actionable metric.
function isAwaiting(t: Ticket): boolean {
  return t.awaitingReply && t.status !== 'solved' && t.status !== 'closed';
}
const byRecency = (a: Ticket, b: Ticket) => (a.lastMessageAt < b.lastMessageAt ? 1 : a.lastMessageAt > b.lastMessageAt ? -1 : 0);

function matchesTicket(t: Ticket, q: string, contact: Contact | undefined): boolean {
  return (
    t.subject.toLowerCase().includes(q) ||
    `#${t.number}`.includes(q) ||
    (contact?.name.toLowerCase().includes(q) ?? false) ||
    (contact?.email.toLowerCase().includes(q) ?? false)
  );
}

/** A slim bar showing how much of a member's load is awaiting a reply (amber) vs handled (green). */
function WorkloadBar({ awaiting, total }: { awaiting: number; total: number }) {
  if (total === 0) return null;
  const awaitingPct = (awaiting / total) * 100;
  return (
    <Tooltip label={`${awaiting} of ${total} awaiting a reply`}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className="h-full bg-amber" style={{ width: `${awaitingPct}%` }} />
        <div className="h-full bg-green" style={{ width: `${100 - awaitingPct}%` }} />
      </div>
    </Tooltip>
  );
}

function StatChip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'amber' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums',
        tone === 'amber' ? 'bg-amber-bg text-amber' : 'bg-surface-2 text-text-2',
      )}
    >
      {children}
    </span>
  );
}

/** Header affordance that opens the inbox pre-filtered to this card's tickets. */
function InboxLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => navigate(to)}
        className="flex size-8 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
      >
        <IconInbox size={16} />
      </button>
    </Tooltip>
  );
}

/** A per-ticket assignee picker: reassign to any active teammate, claim it, or unassign — right from the board. */
function AssigneeMenu({ ticket }: { ticket: Ticket }) {
  const agents = useApp((s) => s.agents);
  const currentAgentId = useApp((s) => s.currentAgentId);
  const assignee = ticket.assigneeId !== null ? (agents[ticket.assigneeId] as Agent | undefined) : undefined;

  function reassign(assigneeId: string | null, done: string) {
    if (assigneeId === ticket.assigneeId) return;
    useApp
      .getState()
      .patchTicket(ticket.id, { assigneeId })
      .then(() => toast(done))
      .catch(() => toast('Could not reassign the ticket'));
  }

  const items: MenuItem[] = [];
  if (ticket.assigneeId !== currentAgentId && agents[currentAgentId]) {
    items.push({ label: 'Assign to me', icon: <IconUser size={15} />, onSelect: () => reassign(currentAgentId, 'Assigned to you') });
    items.push({ separator: true });
  }
  for (const a of Object.values(agents).filter((x) => x.status === 'active').sort((x, y) => x.name.localeCompare(y.name))) {
    items.push({
      label: a.name,
      icon: <Avatar name={a.name} hue={a.avatarHue} size={18} />,
      checked: a.id === ticket.assigneeId,
      onSelect: () => reassign(a.id, `Assigned to ${a.name}`),
    });
  }
  if (ticket.assigneeId !== null) {
    items.push({ separator: true });
    items.push({ label: 'Unassign', icon: <IconUserPlus size={15} />, onSelect: () => reassign(null, 'Unassigned') });
  }

  return (
    <Menu
      align="end"
      triggerLabel={assignee ? `Reassign ticket #${ticket.number} — currently ${assignee.name}` : `Assign ticket #${ticket.number}`}
      triggerClassName="flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-3"
      trigger={
        assignee ? (
          <Avatar name={assignee.name} hue={assignee.avatarHue} size={22} />
        ) : (
          <span className="flex size-[22px] items-center justify-center rounded-full border border-dashed border-line-2 text-text-3">
            <IconUserPlus size={13} />
          </span>
        )
      }
      items={items}
    />
  );
}

/** One assigned ticket, click/Enter to open it. */
function TicketRow({ ticket, contact }: { ticket: Ticket; contact: Contact | undefined }) {
  const navigate = useNavigate();
  const go = () => navigate(`/ticket/${ticket.id}`);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ticket: ${ticket.subject}`}
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 transition-colors hover:bg-surface-2"
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[12px] tabular-nums text-text-3">#{ticket.number}</span>
          <span className="truncate text-[14px] font-medium">{ticket.subject}</span>
          <CategoryPill category={ticket.category} className="shrink-0" />
        </div>
        <div className="truncate text-[13px] text-text-3">
          {contact?.name ?? 'Unknown'}
          {ticket.lastMessagePreview !== '' ? ` · ${ticket.lastMessagePreview}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <PriorityPill priority={ticket.priority} />
        <ReplyStatusBadge ticket={ticket} />
        <TimeAgo iso={ticket.lastMessageAt} className="w-16 text-right text-[13px] text-text-3" />
        {/* Stop clicks/keys here from bubbling to the row's navigate handler. */}
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <AssigneeMenu ticket={ticket} />
        </div>
      </div>
    </div>
  );
}

/** A framed card for one member (or the unassigned bucket): header, workload bar, ticket list. */
function TeamCard({
  title,
  subtitle,
  avatar,
  tickets,
  contacts,
  emptyHint,
  forceOpen = false,
  action,
}: {
  title: ReactNode;
  subtitle?: string;
  avatar: ReactNode;
  tickets: Ticket[];
  contacts: Record<string, Contact>;
  emptyHint: string;
  /** Reveal the ticket list even while collapsed — used during search so matches still show. */
  forceOpen?: boolean;
  /** Optional trailing control in the header (e.g. an "open in inbox" link). */
  action?: ReactNode;
}) {
  // Cards start collapsed; a search temporarily expands them to surface matching tickets.
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;
  const awaiting = tickets.filter(isAwaiting).length;
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-1">
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={expanded}
          // While a search force-opens the card, the manual toggle is inert — otherwise it would
          // silently flip `open` and leave the card stuck open after the search clears.
          onClick={() => {
            if (!forceOpen) setOpen((v) => !v);
          }}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
        >
          {avatar}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">{title}</div>
            {subtitle !== undefined && <div className="truncate text-[13px] text-text-3">{subtitle}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {awaiting > 0 && <StatChip tone="amber">{awaiting} awaiting</StatChip>}
            <StatChip>{tickets.length} active</StatChip>
            <IconChevronDown size={16} className={cx('text-text-3 transition-transform', !expanded && '-rotate-90')} />
          </div>
        </button>
        {action !== undefined && <div className="shrink-0 pr-2">{action}</div>}
      </div>
      {tickets.length > 0 && (
        <div className="px-4 pb-3">
          <WorkloadBar awaiting={awaiting} total={tickets.length} />
        </div>
      )}
      {expanded &&
        (tickets.length > 0 ? (
          <div className="divide-y divide-line border-t border-line">
            {tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} contact={contacts[t.requesterId]} />
            ))}
          </div>
        ) : (
          <div className="border-t border-line px-4 py-3 text-[13px] text-text-3">{emptyHint}</div>
        ))}
    </div>
  );
}

export function TeamPage() {
  const agents = useApp((s) => s.agents);
  const tickets = useApp((s) => s.tickets);
  const contacts = useApp((s) => s.contacts);
  const currentAgentId = useApp((s) => s.currentAgentId);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('busy');
  const q = query.trim().toLowerCase();

  // Group every live ticket by its assignee; hold the unassigned ones aside for a triage bucket.
  const { byAssignee, unassigned } = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    const un: Ticket[] = [];
    for (const t of Object.values(tickets)) {
      if (!isActive(t)) continue;
      if (t.assigneeId === null) {
        un.push(t);
        continue;
      }
      const list = map.get(t.assigneeId) ?? [];
      list.push(t);
      map.set(t.assigneeId, list);
    }
    for (const list of map.values()) list.sort(byRecency);
    un.sort(byRecency);
    return { byAssignee: map, unassigned: un };
  }, [tickets]);

  const totalAssigned = useMemo(() => [...byAssignee.values()].reduce((n, l) => n + l.length, 0), [byAssignee]);
  const totalAwaiting = useMemo(
    () => [...byAssignee.values()].reduce((n, l) => n + l.filter(isAwaiting).length, 0) + unassigned.filter(isAwaiting).length,
    [byAssignee, unassigned],
  );

  // The tickets to show for a member, honoring the search: a member match shows all their
  // tickets; otherwise only the tickets that match the query.
  function visibleFor(agent: Agent): { tickets: Ticket[]; show: boolean } {
    const all = byAssignee.get(agent.id) ?? [];
    if (q === '') return { tickets: all, show: true };
    const memberMatch = agent.name.toLowerCase().includes(q) || agent.email.toLowerCase().includes(q);
    if (memberMatch) return { tickets: all, show: true };
    const hits = all.filter((t) => matchesTicket(t, q, contacts[t.requesterId]));
    return { tickets: hits, show: hits.length > 0 };
  }

  const members = useMemo(() => {
    const active = Object.values(agents).filter((a) => a.status === 'active');
    const withVisible = active.map((a) => ({ agent: a, ...visibleFor(a) })).filter((m) => m.show);
    return withVisible.sort((a, b) => {
      if (a.agent.id === currentAgentId) return -1;
      if (b.agent.id === currentAgentId) return 1;
      if (sort === 'name') return a.agent.name.localeCompare(b.agent.name);
      const av = sort === 'awaiting' ? a.tickets.filter(isAwaiting).length : a.tickets.length;
      const bv = sort === 'awaiting' ? b.tickets.filter(isAwaiting).length : b.tickets.length;
      return bv !== av ? bv - av : a.agent.name.localeCompare(b.agent.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, byAssignee, contacts, currentAgentId, q, sort]);

  const unassignedVisible = useMemo(
    () => (q === '' ? unassigned : unassigned.filter((t) => matchesTicket(t, q, contacts[t.requesterId]))),
    [unassigned, contacts, q],
  );
  const showUnassigned = unassignedVisible.length > 0;

  // Tickets stuck on a teammate who isn't active (invited but not joined, or removed): they're
  // counted in the totals but have no member card, so surface them where they can be reassigned.
  const orphaned = useMemo(() => {
    const activeIds = new Set(Object.values(agents).filter((a) => a.status === 'active').map((a) => a.id));
    const out: Ticket[] = [];
    for (const [assigneeId, list] of byAssignee) if (!activeIds.has(assigneeId)) out.push(...list);
    return out.sort(byRecency);
  }, [agents, byAssignee]);
  const orphanedVisible = useMemo(
    () => (q === '' ? orphaned : orphaned.filter((t) => matchesTicket(t, q, contacts[t.requesterId]))),
    [orphaned, contacts, q],
  );
  const showOrphaned = orphanedVisible.length > 0;

  const sortItems: MenuItem[] = (['busy', 'awaiting', 'name'] as Sort[]).map((s) => ({
    label: SORT_LABEL[s],
    checked: sort === s,
    onSelect: () => setSort(s),
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="text-[15px] font-semibold">Team</h1>
        <span className="hidden tabular-nums text-[13px] text-text-3 sm:inline">
          {members.length} {members.length === 1 ? 'member' : 'members'} · {totalAssigned} active
          {totalAwaiting > 0 && <> · <span className="text-amber">{totalAwaiting} awaiting</span></>}
        </span>
        <div className="flex-1" />
        <Menu
          align="end"
          triggerLabel="Sort members"
          triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          trigger={
            <>
              <span className="text-text-3">Sort:</span>
              <span>{SORT_LABEL[sort]}</span>
              <IconChevronDown size={14} className="text-text-3" />
            </>
          }
          items={sortItems}
        />
        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={query}
            aria-label="Search team"
            placeholder="Search members or tickets"
            className="h-8 w-64 rounded-md border border-line bg-bg pl-8 pr-8 text-[13px] transition-colors focus:border-line-2"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (query !== '') setQuery('');
                else e.currentTarget.blur();
              }
            }}
          />
          {query !== '' && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
            >
              <IconX size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
        {members.length === 0 && !showUnassigned && !showOrphaned ? (
          <EmptyState
            icon={q !== '' ? IconSearch : IconTeam}
            title={q !== '' ? 'No matches' : 'No members yet'}
            hint={q !== '' ? 'Try a different search.' : 'Invite teammates from Settings → Team.'}
          />
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {q === '' && <Leaderboard />}
            {members.map(({ agent, tickets: list }) => (
              <TeamCard
                key={agent.id}
                contacts={contacts}
                tickets={list}
                forceOpen={q !== ''}
                emptyHint="No active tickets assigned."
                action={<InboxLink to={`/view/all?assignee=${agent.id}`} label={`Open ${agent.name}'s tickets in the inbox`} />}
                avatar={<Avatar name={agent.name} hue={agent.avatarHue} size={36} />}
                subtitle={agent.email}
                title={
                  <>
                    <span className="truncate text-[14px] font-semibold">{agent.name}</span>
                    {agent.id === currentAgentId && (
                      <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-text-2">You</span>
                    )}
                    <span className="text-[12px] capitalize text-text-3">{agent.role}</span>
                  </>
                }
              />
            ))}
            {showUnassigned && (
              <TeamCard
                contacts={contacts}
                tickets={unassignedVisible}
                forceOpen={q !== ''}
                emptyHint="Nothing waiting to be picked up."
                action={<InboxLink to="/view/unassigned" label="Open the Unassigned view in the inbox" />}
                avatar={
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-surface-2 text-text-3">
                    <IconUserPlus size={18} />
                  </span>
                }
                title={
                  <>
                    <span className="truncate text-[14px] font-semibold">Unassigned</span>
                    <span className="text-[12px] text-text-3">up for grabs</span>
                  </>
                }
              />
            )}
            {showOrphaned && (
              <TeamCard
                contacts={contacts}
                tickets={orphanedVisible}
                forceOpen={q !== ''}
                emptyHint="Nothing here."
                avatar={
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-amber-bg text-amber">
                    <IconAlert size={18} />
                  </span>
                }
                title={
                  <>
                    <span className="truncate text-[14px] font-semibold">Needs reassignment</span>
                    <span className="text-[12px] text-text-3">assigned to an inactive teammate</span>
                  </>
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
