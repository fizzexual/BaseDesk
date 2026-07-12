import { useEffect, useMemo, useState, type ComponentType, type MouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApp } from '../../data/store';
import { useTicketsForView } from '../../data/hooks';
import type { Contact, Ticket, TicketPatch, TicketPriority, ViewId } from '../../data/types';
import { Button } from '../../components/Button';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { EmptyState } from '../../components/EmptyState';
import { Menu, type MenuItem } from '../../components/Menu';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import {
  IconAlert,
  IconArchive,
  IconCheck,
  IconFilter,
  IconGrid,
  IconInbox,
  IconList,
  IconPlus,
  IconSearch,
  IconSnooze,
  IconTicket,
  IconTrash,
  IconUser,
} from '../../icons';
import { useShortcuts } from '../palette/shortcuts';
import { NewTicketDialog } from './NewTicketDialog';
import { SnoozePopover } from './SnoozePopover';
import { TicketTable } from './TicketTable';
import { TicketCards } from './TicketCards';

type ViewMode = 'list' | 'cards';

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem('basedesk-inbox-view') === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
}

const VIEW_TITLES: Record<ViewId, string> = {
  all: 'All tickets',
  unassigned: 'Unassigned',
  mine: 'My open',
  snoozed: 'Snoozed',
  open: 'Open',
  pending: 'Pending',
  on_hold: 'On hold',
  solved: 'Solved',
  closed: 'Closed',
  archive: 'Archive',
  spam: 'Spam',
  trash: 'Trash',
};

const PRIORITIES: TicketPriority[] = ['urgent', 'high', 'medium', 'low'];
const PRIORITY_LABELS: Record<TicketPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function isViewId(v: string | undefined): v is ViewId {
  return v !== undefined && v in VIEW_TITLES;
}

function tomorrowNine(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

type IconComponent = ComponentType<{ size?: number; className?: string }>;

function emptyFor(view: ViewId): { icon: IconComponent; title: string } {
  switch (view) {
    case 'spam':
      return { icon: IconAlert, title: 'No spam' };
    case 'trash':
      return { icon: IconTrash, title: 'Trash is empty' };
    case 'snoozed':
      return { icon: IconSnooze, title: 'Nothing snoozed' };
    case 'solved':
      return { icon: IconCheck, title: 'Nothing solved yet' };
    default:
      return { icon: IconInbox, title: 'No tickets here' };
  }
}

export function InboxPage() {
  const params = useParams();
  const view: ViewId = isViewId(params.viewId) ? params.viewId : 'all';
  const navigate = useNavigate();
  const ticketsInView = useTicketsForView(view);
  const contacts = useApp((s) => s.contacts);
  const agents = useApp((s) => s.agents);
  const currentAgentId = useApp((s) => s.currentAgentId);
  const patchTicket = useApp((s) => s.patchTicket);

  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [snooze, setSnooze] = useState<{ ticket: Ticket; rect: DOMRect } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; ticket: Ticket } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);

  function chooseViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem('basedesk-inbox-view', mode);
    } catch {
      /* ignore */
    }
  }

  const agentList = useMemo(
    () => Object.values(agents).sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ticketsInView.filter((t) => {
      if (priorityFilter !== null && t.priority !== priorityFilter) return false;
      if (assigneeFilter !== null && t.assigneeId !== assigneeFilter) return false;
      if (q === '') return true;
      const contact = contacts[t.requesterId] as Contact | undefined;
      return (
        t.subject.toLowerCase().includes(q) ||
        t.lastMessagePreview.toLowerCase().includes(q) ||
        (contact !== undefined && contact.name.toLowerCase().includes(q))
      );
    });
  }, [ticketsInView, contacts, query, priorityFilter, assigneeFilter]);

  const selected: Ticket | undefined = selectedIndex >= 0 ? visible[selectedIndex] : undefined;

  // Selection resets when the view changes.
  useEffect(() => {
    setSelectedIndex(-1);
    setSnooze(null);
    setCtx(null);
  }, [view]);

  // Keep the selection inside the list when it shrinks (solve, filter, …).
  useEffect(() => {
    if (selectedIndex >= visible.length) setSelectedIndex(visible.length - 1);
  }, [selectedIndex, visible.length]);

  useEffect(() => {
    const onNewTicket = () => setNewTicketOpen(true);
    window.addEventListener('basedesk:new-ticket', onNewTicket);
    return () => window.removeEventListener('basedesk:new-ticket', onNewTicket);
  }, []);

  function run(id: string, patch: TicketPatch) {
    patchTicket(id, patch).catch(() => toast('Could not update the ticket'));
  }

  function move(dir: 1 | -1) {
    setSnooze(null);
    const len = visible.length;
    if (len === 0) return;
    setSelectedIndex((i) => (i < 0 ? (dir === 1 ? 0 : len - 1) : (i + dir + len) % len));
  }

  function openSelected() {
    if (selected) navigate(`/ticket/${selected.id}`);
  }

  function markSolved() {
    if (!selected || selected.status === 'solved') return;
    const { id, status } = selected;
    run(id, { status: 'solved' });
    toast('Marked solved', { undo: () => run(id, { status }) });
  }

  function assignToMe() {
    if (!selected || selected.assigneeId === currentAgentId) return;
    run(selected.id, { assigneeId: currentAgentId });
    toast('Assigned to you');
  }

  function setSelectedPriority(priority: TicketPriority) {
    if (!selected || selected.priority === priority) return;
    run(selected.id, { priority });
  }

  function toggleSnooze() {
    if (snooze !== null) {
      setSnooze(null);
      return;
    }
    if (!selected) return;
    const el = document.querySelector(`[data-ticket-id="${CSS.escape(selected.id)}"]`);
    if (el instanceof HTMLElement) setSnooze({ ticket: selected, rect: el.getBoundingClientRect() });
  }

  function applySnooze(date: Date, toastLabel: string) {
    if (snooze === null) return;
    const { id, snoozedUntil } = snooze.ticket;
    setSnooze(null);
    run(id, { snoozedUntil: date.toISOString() });
    toast(`Snoozed until ${toastLabel}`, { undo: () => run(id, { snoozedUntil }) });
  }

  // Right-click quick actions on a ticket row (list or card layout).
  function openRowMenu(e: MouseEvent, ticket: Ticket) {
    e.preventDefault();
    setSnooze(null);
    setCtx({ x: e.clientX, y: e.clientY, ticket });
  }

  function rowMenuItems(t: Ticket): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: 'Open', icon: <IconTicket size={15} />, onSelect: () => navigate(`/ticket/${t.id}`) },
      { separator: true },
    ];
    if (t.assigneeId !== currentAgentId) {
      items.push({
        label: 'Assign to me',
        icon: <IconUser size={15} />,
        onSelect: () => {
          run(t.id, { assigneeId: currentAgentId });
          toast('Assigned to you');
        },
      });
    }
    if (t.status !== 'solved' && t.status !== 'closed') {
      items.push({
        label: 'Mark solved',
        icon: <IconCheck size={15} />,
        onSelect: () => {
          const prev = t.status;
          run(t.id, { status: 'solved' });
          toast('Marked solved', { undo: () => run(t.id, { status: prev }) });
        },
      });
    } else {
      items.push({ label: 'Reopen', icon: <IconInbox size={15} />, onSelect: () => run(t.id, { status: 'open' }) });
    }
    items.push({
      label: 'Snooze to tomorrow',
      icon: <IconSnooze size={15} />,
      onSelect: () => {
        const prev = t.snoozedUntil;
        run(t.id, { snoozedUntil: tomorrowNine().toISOString() });
        toast('Snoozed until tomorrow', { undo: () => run(t.id, { snoozedUntil: prev }) });
      },
    });
    items.push({ separator: true });
    if (t.bucket === 'inbox') {
      items.push({
        label: 'Archive',
        icon: <IconArchive size={15} />,
        onSelect: () => {
          run(t.id, { bucket: 'archive' });
          toast('Archived', { undo: () => run(t.id, { bucket: 'inbox' }) });
        },
      });
      items.push({
        label: 'Move to trash',
        icon: <IconTrash size={15} />,
        danger: true,
        onSelect: () => {
          run(t.id, { bucket: 'trash' });
          toast('Moved to trash', { undo: () => run(t.id, { bucket: 'inbox' }) });
        },
      });
    } else {
      items.push({
        label: 'Move to inbox',
        icon: <IconInbox size={15} />,
        onSelect: () => {
          run(t.id, { bucket: 'inbox' });
          toast('Moved to inbox');
        },
      });
    }
    return items;
  }

  useShortcuts(
    'inbox',
    {
      j: () => move(1),
      k: () => move(-1),
      enter: openSelected,
      o: openSelected,
      e: markSolved,
      u: assignToMe,
      '1': () => setSelectedPriority('urgent'),
      '2': () => setSelectedPriority('high'),
      '3': () => setSelectedPriority('medium'),
      '4': () => setSelectedPriority('low'),
      s: toggleSnooze,
      escape: () => setSnooze(null),
    },
    !newTicketOpen,
  );

  const filterCount = (priorityFilter !== null ? 1 : 0) + (assigneeFilter !== null ? 1 : 0);
  const filterItems: MenuItem[] = [
    {
      label: 'All priorities',
      checked: priorityFilter === null,
      onSelect: () => setPriorityFilter(null),
    },
    ...PRIORITIES.map(
      (p): MenuItem => ({
        label: PRIORITY_LABELS[p],
        checked: priorityFilter === p,
        onSelect: () => setPriorityFilter(p),
      }),
    ),
    { separator: true },
    {
      label: 'All assignees',
      checked: assigneeFilter === null,
      onSelect: () => setAssigneeFilter(null),
    },
    ...agentList.map(
      (a): MenuItem => ({
        label: a.name,
        checked: assigneeFilter === a.id,
        onSelect: () => setAssigneeFilter(a.id),
      }),
    ),
  ];

  const total = ticketsInView.length;
  const countLabel =
    visible.length === total
      ? `${total.toLocaleString('en-US')} ${total === 1 ? 'ticket' : 'tickets'}`
      : `${visible.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} tickets`;
  const empty = emptyFor(view);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
        <h1 className="text-[15px] font-semibold">{VIEW_TITLES[view]}</h1>
        <span className="tabular-nums text-[13px] text-text-3">{countLabel}</span>
        <div className="flex-1" />
        <div className="relative">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3"
          />
          <input
            value={query}
            aria-label="Search tickets in this view"
            placeholder="Search tickets"
            className="h-8 w-56 rounded-md border border-line bg-bg pl-8 pr-2.5 text-[13px] transition-colors focus:border-line-2"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (query !== '') setQuery('');
                else e.currentTarget.blur();
              }
            }}
          />
        </div>
        <Menu
          align="end"
          triggerLabel="Filter tickets"
          triggerClassName={cx(
            'h-8 select-none gap-1.5 whitespace-nowrap rounded-sm px-3 text-[13px] font-medium transition',
            filterCount > 0 ? 'bg-surface-2 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
          )}
          trigger={
            <>
              <IconFilter size={15} className="shrink-0" />
              <span>Filter</span>
              {filterCount > 0 && <span className="tabular-nums text-text-3">{filterCount}</span>}
            </>
          }
          items={filterItems}
        />
        <div className="flex h-8 items-center rounded-md bg-surface-2 p-0.5" role="group" aria-label="Ticket layout">
          {([
            { mode: 'list' as const, Icon: IconList, label: 'List view' },
            { mode: 'cards' as const, Icon: IconGrid, label: 'Card view' },
          ]).map(({ mode, Icon, label }) => (
            <button
              key={mode}
              type="button"
              aria-label={label}
              aria-pressed={viewMode === mode}
              className={cx(
                'inline-flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors',
                viewMode === mode ? 'bg-surface text-text shadow-1' : 'text-text-2 hover:text-text',
              )}
              onClick={() => chooseViewMode(mode)}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={() => setNewTicketOpen(true)}>
          <IconPlus size={15} className="shrink-0" />
          New ticket
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length > 0 ? (
          viewMode === 'cards' ? (
            <TicketCards tickets={visible} selectedId={selected?.id ?? null} onRowContextMenu={openRowMenu} />
          ) : (
            <TicketTable tickets={visible} selectedId={selected?.id ?? null} onRowContextMenu={openRowMenu} />
          )
        ) : total > 0 ? (
          <EmptyState
            icon={IconSearch}
            title="No matching tickets"
            hint="Try a different search or clear the filters."
          />
        ) : (
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            hint="Tickets that match this view will show up here."
          />
        )}
      </div>

      {snooze !== null && (
        <SnoozePopover anchor={snooze.rect} onPick={applySnooze} onClose={() => setSnooze(null)} />
      )}
      {ctx !== null && (
        <ContextMenu x={ctx.x} y={ctx.y} items={rowMenuItems(ctx.ticket)} onClose={() => setCtx(null)} />
      )}
      <NewTicketDialog open={newTicketOpen} onClose={() => setNewTicketOpen(false)} />
    </div>
  );
}
