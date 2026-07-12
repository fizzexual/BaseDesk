import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../data/store';
import type { Contact, Ticket, ViewId } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { cx } from '../../components/util';
import { openHelp, requestNewTicket } from './shortcuts';
import {
  IconAlert,
  IconArchive,
  IconBook,
  IconChart,
  IconCheck,
  IconCheckCircle,
  IconCircle,
  IconClock,
  IconContacts,
  IconKeyboard,
  IconPause,
  IconPlus,
  IconRevenue,
  IconSearch,
  IconSettings,
  IconSnooze,
  IconSun,
  IconTicket,
  IconTrash,
  IconUser,
  IconUserPlus,
} from '../../icons';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

type ViewItem = { kind: 'view'; id: ViewId; label: string; icon: IconComponent };
type ActionItem = { kind: 'action'; id: string; label: string; icon: IconComponent; run: () => void };
type TicketItem = { kind: 'ticket'; ticket: Ticket };
type ContactItem = { kind: 'contact'; contact: Contact };
type PaletteItem = ViewItem | ActionItem | TicketItem | ContactItem;

const VIEW_ITEMS: ViewItem[] = [
  { kind: 'view', id: 'all', label: 'All tickets', icon: IconTicket },
  { kind: 'view', id: 'unassigned', label: 'Unassigned', icon: IconUserPlus },
  { kind: 'view', id: 'mine', label: 'My open', icon: IconUser },
  { kind: 'view', id: 'snoozed', label: 'Snoozed', icon: IconSnooze },
  { kind: 'view', id: 'open', label: 'Open', icon: IconCircle },
  { kind: 'view', id: 'pending', label: 'Pending', icon: IconClock },
  { kind: 'view', id: 'on_hold', label: 'On hold', icon: IconPause },
  { kind: 'view', id: 'solved', label: 'Solved', icon: IconCheck },
  { kind: 'view', id: 'closed', label: 'Closed', icon: IconCheckCircle },
  { kind: 'view', id: 'archive', label: 'Archive', icon: IconArchive },
  { kind: 'view', id: 'spam', label: 'Spam', icon: IconAlert },
  { kind: 'view', id: 'trash', label: 'Trash', icon: IconTrash },
];

/** Case-insensitive subsequence match; both inputs already lowercased. */
function isSubsequence(query: string, label: string): boolean {
  let i = 0;
  for (const ch of label) {
    if (i < query.length && ch === query[i]) i += 1;
  }
  return i === query.length;
}

/** Subsequence filter, exact-prefix matches ranked first. */
function rankFilter<T>(items: readonly T[], getLabel: (item: T) => string, query: string): T[] {
  const prefix: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const label = getLabel(item).toLowerCase();
    if (label.startsWith(query)) prefix.push(item);
    else if (isSubsequence(query, label)) rest.push(item);
  }
  return [...prefix, ...rest];
}

function itemKey(item: PaletteItem): string {
  switch (item.kind) {
    case 'view':
      return `view-${item.id}`;
    case 'action':
      return `action-${item.id}`;
    case 'ticket':
      return `ticket-${item.ticket.id}`;
    case 'contact':
      return `contact-${item.contact.id}`;
  }
}

export function Palette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const tickets = useApp((s) => s.tickets);
  const contacts = useApp((s) => s.contacts);

  useEffect(() => {
    function onOpen() {
      setQuery('');
      setSelected(0);
      setOpen(true);
    }
    window.addEventListener('basedesk:open-palette', onOpen);
    return () => window.removeEventListener('basedesk:open-palette', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const q = query.trim().toLowerCase();

  const ticketMatches = useMemo(
    () => (q === '' ? [] : useApp.getState().searchLocal(q).slice(0, 8)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchLocal reads tickets/contacts
    [q, tickets, contacts],
  );

  const contactMatches = useMemo(() => {
    if (q === '') return [];
    return Object.values(contacts)
      .filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 5);
  }, [q, contacts]);

  const actions: ActionItem[] = [
    {
      kind: 'action',
      id: 'new-ticket',
      label: 'New ticket',
      icon: IconPlus,
      run: () => {
        navigate('/view/all');
        window.setTimeout(requestNewTicket, 0);
      },
    },
    {
      kind: 'action',
      id: 'toggle-theme',
      label: 'Toggle theme',
      icon: IconSun,
      run: () => {
        const { theme, setTheme } = useApp.getState();
        setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');
      },
    },
    { kind: 'action', id: 'shortcuts', label: 'Keyboard shortcuts', icon: IconKeyboard, run: openHelp },
    {
      kind: 'action',
      id: 'new-contact',
      label: 'New contact',
      icon: IconUserPlus,
      run: () => {
        navigate('/contacts');
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('basedesk:new-contact')), 0);
      },
    },
    { kind: 'action', id: 'go-revenue', label: 'Go to Revenue', icon: IconRevenue, run: () => navigate('/revenue') },
    { kind: 'action', id: 'go-reports', label: 'Go to Reports', icon: IconChart, run: () => navigate('/reports') },
    { kind: 'action', id: 'go-kb', label: 'Go to Knowledge base', icon: IconBook, run: () => navigate('/kb') },
    { kind: 'action', id: 'go-contacts', label: 'Go to Contacts', icon: IconContacts, run: () => navigate('/contacts') },
    { kind: 'action', id: 'go-settings', label: 'Go to Settings', icon: IconSettings, run: () => navigate('/settings') },
  ];

  const viewItems = q === '' ? VIEW_ITEMS.slice(0, 5) : rankFilter(VIEW_ITEMS, (v) => v.label, q);
  const actionItems = q === '' ? actions : rankFilter(actions, (a) => a.label, q);

  const groups: { title: string; items: PaletteItem[] }[] = [];
  if (viewItems.length > 0) groups.push({ title: 'Views', items: viewItems });
  if (actionItems.length > 0) groups.push({ title: 'Actions', items: actionItems });
  if (ticketMatches.length > 0) {
    groups.push({ title: 'Tickets', items: ticketMatches.map((ticket): TicketItem => ({ kind: 'ticket', ticket })) });
  }
  if (contactMatches.length > 0) {
    groups.push({
      title: 'Contacts',
      items: contactMatches.map((contact): ContactItem => ({ kind: 'contact', contact })),
    });
  }
  const flat = groups.flatMap((g) => g.items);
  const sel = flat.length === 0 ? -1 : Math.min(selected, flat.length - 1);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  function close() {
    setOpen(false);
  }

  function execute(item: PaletteItem) {
    close();
    switch (item.kind) {
      case 'view':
        navigate(`/view/${item.id}`);
        break;
      case 'action':
        item.run();
        break;
      case 'ticket':
        navigate(`/ticket/${item.ticket.id}`);
        break;
      case 'contact':
        navigate(`/contacts/${item.contact.id}`);
        break;
    }
  }

  function onPanelKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(sel < 0 ? 0 : Math.min(sel + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(sel < 0 ? 0 : Math.max(sel - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[sel];
      if (item) execute(item);
    }
  }

  function renderRow(item: PaletteItem) {
    if (item.kind === 'view' || item.kind === 'action') {
      const Icon = item.icon;
      return (
        <>
          <Icon size={16} className="shrink-0 text-text-2" />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </>
      );
    }
    if (item.kind === 'ticket') {
      const requester = contacts[item.ticket.requesterId] as Contact | undefined;
      return (
        <>
          <Avatar name={requester?.name ?? '?'} hue={requester?.avatarHue ?? 0} size={20} />
          <span className="min-w-0 flex-1 truncate">{item.ticket.subject}</span>
          <span className="shrink-0 text-[12px] text-text-3 tabular-nums">#{item.ticket.number}</span>
        </>
      );
    }
    return (
      <>
        <Avatar name={item.contact.name} hue={item.contact.avatarHue} size={20} />
        <span className="shrink-0 truncate">{item.contact.name}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-3">{item.contact.email}</span>
      </>
    );
  }

  let idx = 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div
        aria-hidden="true"
        className="fixed inset-0"
        style={{ background: 'rgb(0 0 0 / 0.32)' }}
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex max-h-[420px] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2"
        onKeyDown={onPanelKeyDown}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <IconSearch size={16} className="shrink-0 text-text-3" />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Search tickets, views, actions…"
            aria-label="Search tickets, views, actions"
            className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-text-3"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {flat.length === 0 ? (
            <EmptyState icon={IconSearch} title="No matches" hint="Try a different search" />
          ) : (
            groups.map((group) => (
              <div key={group.title}>
                <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const i = idx;
                  idx += 1;
                  return (
                    <button
                      key={itemKey(item)}
                      type="button"
                      ref={i === sel ? selectedRef : undefined}
                      className={cx(
                        'flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-[13.5px]',
                        i === sel && 'bg-surface-2',
                      )}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => execute(item)}
                    >
                      {renderRow(item)}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
