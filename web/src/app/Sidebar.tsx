import { useMemo, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router';
import { useCounts } from '../data/hooks';
import { useApp } from '../data/store';
import type { Counts, ViewId } from '../data/types';
import { cx } from '../components/util';
import { Tooltip } from '../components/Tooltip';
import { requestNewTicket } from '../features/palette/shortcuts';
import {
  IconAlert,
  IconArchive,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconCircle,
  IconClock,
  IconFilter,
  IconNote,
  IconPause,
  IconPlus,
  IconReply,
  IconSnooze,
  IconSparkle,
  IconTicket,
  IconTrash,
  IconUser,
  IconUserPlus,
  IconX,
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
  { view: 'awaiting', label: 'Awaiting reply', icon: IconReply, showCount: true },
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

/** Rich-tooltip copy for nav views whose name alone doesn't say what they show. */
const VIEW_EXPLAINERS: Partial<Record<ViewId, { title: string; desc: string }>> = {
  unassigned: { title: 'Unassigned', desc: 'Open tickets nobody has picked up yet.' },
  mine: { title: 'My open', desc: 'Open tickets currently assigned to you.' },
  awaiting: {
    title: 'Awaiting reply',
    desc: 'The customer sent the last message on these tickets — your team owes a response.',
  },
  on_hold: {
    title: 'On hold',
    desc: 'Paused by the team — usually blocked on a third party or a scheduled fix.',
  },
  snoozed: {
    title: 'Snoozed',
    desc: 'Tickets paused until a set time, then they’ll reappear in your inbox.',
  },
};

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
  const explainer = VIEW_EXPLAINERS[item.view];
  const icon = <Icon size={17} className="shrink-0" />;
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
      {explainer ? (
        <Tooltip title={explainer.title} label={explainer.desc}>
          {icon}
        </Tooltip>
      ) : (
        icon
      )}
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

const aiLinkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium transition-colors',
    isActive ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
  );

export function Sidebar() {
  const counts = useCounts();
  const aiActions = useApp((s) => s.aiActions);
  const aiCounts = useMemo(() => {
    let drafts = 0;
    let resolved = 0;
    for (const a of Object.values(aiActions)) {
      if (a.kind === 'draft' && a.status === 'pending') drafts += 1;
      if (a.kind === 'resolve') resolved += 1;
    }
    return { drafts, resolved };
  }, [aiActions]);
  const savedViews = useApp((s) => s.savedViews);
  const deleteSavedView = useApp((s) => s.deleteSavedView);
  const [searchParams] = useSearchParams();
  const activeSv = searchParams.get('sv');
  const [ticketsOpen, setTicketsOpen] = useState(() => readBool('basedesk-nav-tickets', true));
  const [savedOpen, setSavedOpen] = useState(() => readBool('basedesk-nav-saved', true));
  const [aiOpen, setAiOpen] = useState(() => readBool('basedesk-nav-ai', true));
  const [more, setMore] = useState(() => readBool('basedesk-nav-more', true));

  return (
    <aside className="flex w-[236px] shrink-0 flex-col gap-1 overflow-y-auto py-3 pr-2">
      <div className="mb-2 flex items-center justify-between pl-2">
        <h1 className="text-[16px] font-semibold">Inbox</h1>
        <Tooltip label="New ticket">
          <button
            type="button"
            aria-label="New ticket"
            className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg transition-opacity hover:opacity-85"
            onClick={requestNewTicket}
          >
            <IconPlus size={16} />
          </button>
        </Tooltip>
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

      {savedViews.length > 0 && (
        <>
          <div className="mt-3" />
          <GroupHeader
            label="Saved"
            open={savedOpen}
            onToggle={() => {
              setSavedOpen(!savedOpen);
              writeBool('basedesk-nav-saved', !savedOpen);
            }}
          />
          {savedOpen &&
            savedViews.map((v) => (
              <div key={v.id} className="group flex items-center">
                <NavLink
                  to={`/view/${v.view}?sv=${v.id}`}
                  className={cx(
                    'flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium transition-colors',
                    activeSv === v.id ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
                  )}
                >
                  <IconFilter size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                </NavLink>
                <Tooltip label="Delete view">
                  <button
                    type="button"
                    aria-label={`Delete saved view ${v.name}`}
                    className="ml-0.5 hidden size-6 shrink-0 items-center justify-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-red group-hover:flex"
                    onClick={() => void deleteSavedView(v.id).catch(() => {})}
                  >
                    <IconX size={13} />
                  </button>
                </Tooltip>
              </div>
            ))}
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
          <NavLink to="/ai" end className={aiLinkClass}>
            <IconSparkle size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Overview</span>
          </NavLink>
          <NavLink to="/ai/drafts" className={aiLinkClass}>
            <IconNote size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Drafts</span>
            {aiCounts.drafts > 0 && (
              <span className="text-[13px] font-normal text-text-3 tabular-nums">{aiCounts.drafts}</span>
            )}
          </NavLink>
          <NavLink to="/ai/resolved" className={aiLinkClass}>
            <IconCheckCircle size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">Resolved by AI</span>
            {aiCounts.resolved > 0 && (
              <span className="text-[13px] font-normal text-text-3 tabular-nums">{aiCounts.resolved}</span>
            )}
          </NavLink>
        </>
      )}
    </aside>
  );
}
