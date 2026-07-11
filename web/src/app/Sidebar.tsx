import { useState } from 'react';
import { NavLink } from 'react-router';
import { useCounts } from '../data/hooks';
import type { Counts, ViewId } from '../data/types';
import { cx } from '../components/util';
import { requestNewTicket } from '../features/palette/shortcuts';
import {
  IconAlert,
  IconArchive,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconCircle,
  IconClock,
  IconNote,
  IconPause,
  IconPlus,
  IconSnooze,
  IconSparkle,
  IconTicket,
  IconTrash,
  IconUser,
  IconUserPlus,
} from '../icons';

type Item = {
  view: ViewId;
  label: string;
  icon: (p: { size?: number; className?: string }) => React.ReactNode;
  showCount?: boolean;
};

const MAIN_ITEMS: Item[] = [
  { view: 'all', label: 'All', icon: IconTicket },
  { view: 'unassigned', label: 'Unassigned', icon: IconUserPlus, showCount: true },
  { view: 'mine', label: 'My open', icon: IconUser, showCount: true },
];

const STATUS_ITEMS: Item[] = [
  { view: 'open', label: 'Open', icon: IconCircle, showCount: true },
  { view: 'pending', label: 'Pending', icon: IconClock, showCount: true },
  { view: 'on_hold', label: 'On hold', icon: IconPause, showCount: true },
  { view: 'snoozed', label: 'Snoozed', icon: IconSnooze, showCount: true },
  { view: 'solved', label: 'Solved', icon: IconCheck },
  { view: 'closed', label: 'Closed', icon: IconCheckCircle },
];

const EXTRA_ITEMS: Item[] = [
  { view: 'archive', label: 'Archive', icon: IconArchive },
  { view: 'spam', label: 'Spam', icon: IconAlert },
  { view: 'trash', label: 'Trash', icon: IconTrash },
];

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function SidebarLink({ item, counts }: { item: Item; counts: Counts }) {
  const Icon = item.icon;
  const count = counts[item.view as keyof Counts];
  return (
    <NavLink
      to={`/view/${item.view}`}
      className={({ isActive }) =>
        cx(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium transition-colors',
          isActive ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
        )
      }
    >
      <Icon size={17} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.showCount && count > 0 && (
        <span className="text-[13px] font-normal text-text-3 tabular-nums">{count}</span>
      )}
    </NavLink>
  );
}

function GroupHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[14px] font-semibold text-text transition-colors hover:bg-surface-2"
      onClick={onToggle}
    >
      {label}
      <IconChevronDown size={16} className={cx('text-text-3 transition-transform', !open && '-rotate-90')} />
    </button>
  );
}

export function Sidebar() {
  const counts = useCounts();
  const [ticketsOpen, setTicketsOpen] = useState(() => readBool('basedesk-nav-tickets', true));
  const [aiOpen, setAiOpen] = useState(() => readBool('basedesk-nav-ai', true));
  const [more, setMore] = useState(() => readBool('basedesk-nav-more', true));

  return (
    <aside className="flex w-[236px] shrink-0 flex-col gap-1 overflow-y-auto py-3 pr-2">
      <div className="mb-2 flex items-center justify-between pl-2">
        <h1 className="text-[16px] font-semibold">Inbox</h1>
        <button
          type="button"
          aria-label="New ticket"
          className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg transition-opacity hover:opacity-85"
          onClick={requestNewTicket}
        >
          <IconPlus size={16} />
        </button>
      </div>

      <GroupHeader
        label="Tickets"
        open={ticketsOpen}
        onToggle={() => {
          setTicketsOpen(!ticketsOpen);
          writeBool('basedesk-nav-tickets', !ticketsOpen);
        }}
      />
      {ticketsOpen && (
        <>
          {MAIN_ITEMS.map((item) => (
            <SidebarLink key={item.view} item={item} counts={counts} />
          ))}
          <div className="mx-2 my-1.5 h-px bg-line" />
          {STATUS_ITEMS.map((item) => (
            <SidebarLink key={item.view} item={item} counts={counts} />
          ))}
          <div className="mx-2 my-1.5 h-px bg-line" />
          {more &&
            EXTRA_ITEMS.map((item) => (
              <SidebarLink key={item.view} item={item} counts={counts} />
            ))}
          <button
            type="button"
            className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium text-text-3 transition-colors hover:bg-surface-2 hover:text-text-2"
            onClick={() => {
              setMore(!more);
              writeBool('basedesk-nav-more', !more);
            }}
          >
            <IconChevronDown size={16} className={cx('transition-transform', more && 'rotate-180')} />
            {more ? 'Less' : 'More'}
          </button>
        </>
      )}

      <div className="mt-3" />
      <GroupHeader
        label="AI Agents"
        open={aiOpen}
        onToggle={() => {
          setAiOpen(!aiOpen);
          writeBool('basedesk-nav-ai', !aiOpen);
        }}
      />
      {aiOpen && (
        <>
          <NavLink
            to="/ai"
            className={({ isActive }) =>
              cx(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium transition-colors',
                isActive ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <IconSparkle size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Overview</span>
          </NavLink>
          <div className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium text-text-3">
            <IconNote size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Drafts</span>
            <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium">soon</span>
          </div>
          <div className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium text-text-3">
            <IconCheckCircle size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Resolved by AI</span>
            <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium">soon</span>
          </div>
        </>
      )}
    </aside>
  );
}
