import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApp } from '../../data/store';
import type { ChannelConn, Ticket, TicketPatch, TicketStatus } from '../../data/types';
import { computeTicketSla } from '../../data/sla';
import { Avatar } from '../../components/Avatar';
import { Menu, type MenuItem } from '../../components/Menu';
import { PriorityPill } from '../../components/PriorityPill';
import { StatusBadge } from '../../components/StatusBadge';
import { SlaBadge } from '../../components/SlaBadge';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import {
  IconAlert,
  IconArchive,
  IconCheck,
  IconCheckCircle,
  IconChevronLeft,
  IconCircle,
  IconClock,
  IconDots,
  IconInbox,
  IconPause,
  IconPlus,
  IconSnooze,
  IconTag,
  IconTicket,
  IconTrash,
  IconUser,
  IconX,
} from '../../icons';
import { useShortcuts } from '../palette/shortcuts';
import { CHANNEL_META } from '../channels/ChannelDialog';
import { Conversation } from './Conversation';
import { Composer } from './Composer';
import { ContextPanel } from './ContextPanel';
import { TriageBar } from './TriageBar';

const ICON_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text';

const STATUSES: Array<{ value: TicketStatus; label: string; icon: ReactNode }> = [
  { value: 'open', label: 'Open', icon: <IconCircle size={14} /> },
  { value: 'pending', label: 'Pending', icon: <IconClock size={14} /> },
  { value: 'on_hold', label: 'On hold', icon: <IconPause size={14} /> },
  { value: 'solved', label: 'Solved', icon: <IconCheck size={14} /> },
  { value: 'closed', label: 'Closed', icon: <IconCheckCircle size={14} /> },
];

function laterToday(): string {
  return new Date(Date.now() + 4 * 3600_000).toISOString();
}

function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function nextMondayNine(): string {
  const d = new Date();
  const delta = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function formatSnooze(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SubjectTitle({ ticket, onRename }: { ticket: Ticket; onRename: (subject: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.subject);
  const cancelRef = useRef(false);

  function commit() {
    const next = draft.trim();
    if (next !== '' && next !== ticket.subject) onRename(next);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        title="Rename ticket"
        className="min-w-0 flex-1 truncate rounded-sm text-left text-[15px] font-semibold hover:bg-surface-2 px-1 -mx-1"
        onClick={() => {
          setDraft(ticket.subject);
          cancelRef.current = false;
          setEditing(true);
        }}
      >
        {ticket.subject}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      aria-label="Ticket subject"
      className="min-w-0 flex-1 rounded-sm border border-line-2 bg-surface px-1 -mx-1 text-[15px] font-semibold outline-none"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelRef.current = true;
          setEditing(false);
        }
      }}
      onBlur={() => {
        if (!cancelRef.current) commit();
        cancelRef.current = false;
      }}
    />
  );
}

function TagsRow({ ticket, onPatch }: { ticket: Ticket; onPatch: (patch: TicketPatch) => void }) {
  const tickets = useApp((s) => s.tickets);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const suggestions = useMemo(() => {
    const all = new Set<string>();
    for (const t of Object.values(tickets)) for (const tag of t.tags) all.add(tag);
    for (const tag of ticket.tags) all.delete(tag);
    return [...all].sort();
  }, [tickets, ticket.tags]);

  function commit() {
    const tag = draft.trim();
    if (tag !== '' && !ticket.tags.includes(tag)) onPatch({ tags: [...ticket.tags, tag] });
    setDraft('');
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
      <IconTag size={14} className="shrink-0 text-text-3" />
      {ticket.tags.map((tag) => (
        <span
          key={tag}
          className="group inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-text-2"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            className="hidden text-text-3 hover:text-text group-hover:inline-flex"
            onClick={() => onPatch({ tags: ticket.tags.filter((t) => t !== tag) })}
          >
            <IconX size={10} />
          </button>
        </span>
      ))}
      {adding ? (
        <>
          <input
            autoFocus
            list="basedesk-tag-suggestions"
            value={draft}
            aria-label="New tag"
            placeholder="Tag name"
            className="h-6 w-36 rounded-full border border-line-2 bg-surface px-2.5 text-[12px] font-medium outline-none placeholder:text-text-3"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setDraft('');
                setAdding(false);
              }
            }}
            onBlur={commit}
          />
          <datalist id="basedesk-tag-suggestions">
            {suggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </>
      ) : (
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
          onClick={() => setAdding(true)}
        >
          <IconPlus size={12} />
          Add tag
        </button>
      )}
      {ticket.snoozedUntil !== null && (
        <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full bg-amber-bg px-2.5 text-[12px] font-medium text-amber">
          <IconSnooze size={12} />
          Snoozed until {formatSnooze(ticket.snoozedUntil)}
        </span>
      )}
    </div>
  );
}

export function TicketPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const ticket = useApp((s) => s.tickets[id]) as Ticket | undefined;
  const agents = useApp((s) => s.agents);
  const slaTargets = useApp((s) => s.sla);
  const slaHours = useApp((s) => s.slaHours);
  const channels = useApp((s) => s.channels);
  const exists = ticket !== undefined;

  useEffect(() => {
    if (exists) void useApp.getState().loadMessages(id).catch(() => {});
  }, [id, exists]);

  useShortcuts('ticket', {
    escape: () => navigate(-1),
    e: () => patch({ status: 'solved' }),
  });

  function patch(p: TicketPatch) {
    useApp
      .getState()
      .patchTicket(id, p)
      .catch(() => toast('Could not save that change'));
  }

  if (!ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <EmptyState icon={IconTicket} title="Ticket not found" hint="It may have been removed." />
        <Link to="/view/all" className="text-[13px] font-medium text-text-2 hover:text-text">
          Back to inbox
        </Link>
      </div>
    );
  }

  const assignee = ticket.assigneeId !== null ? agents[ticket.assigneeId] : undefined;
  const agentList = Object.values(agents);

  const sourceChannel: ChannelConn | undefined =
    ticket.channelId !== null ? channels[ticket.channelId] : undefined;
  const SourceGlyph = sourceChannel ? CHANNEL_META[sourceChannel.type].glyph : null;

  const assigneeItems: MenuItem[] = agentList.map((a) => ({
    label: a.name,
    icon: <Avatar name={a.name} hue={a.avatarHue} size={16} />,
    checked: a.id === ticket.assigneeId,
    onSelect: () => patch({ assigneeId: a.id }),
  }));
  if (assignee) {
    assigneeItems.push({ separator: true }, { label: 'Unassign', onSelect: () => patch({ assigneeId: null }) });
  }

  const snoozeItems: MenuItem[] = [
    { label: 'Later today', onSelect: () => patch({ snoozedUntil: laterToday() }) },
    { label: 'Tomorrow 09:00', onSelect: () => patch({ snoozedUntil: tomorrowNine() }) },
    { label: 'Next Monday 09:00', onSelect: () => patch({ snoozedUntil: nextMondayNine() }) },
  ];
  if (ticket.snoozedUntil !== null) {
    snoozeItems.push({ separator: true }, { label: 'Clear snooze', onSelect: () => patch({ snoozedUntil: null }) });
  }

  function moveBucket(bucket: 'archive' | 'spam' | 'trash', message: string) {
    patch({ bucket });
    toast(message, { undo: () => patch({ bucket: 'inbox' }) });
  }

  const kebabItems: MenuItem[] =
    ticket.bucket === 'inbox'
      ? [
          {
            label: 'Archive',
            icon: <IconArchive size={14} />,
            onSelect: () => moveBucket('archive', 'Ticket archived'),
          },
          {
            label: 'Mark as spam',
            icon: <IconAlert size={14} />,
            onSelect: () => moveBucket('spam', 'Marked as spam'),
          },
          {
            label: 'Move to trash',
            icon: <IconTrash size={14} />,
            danger: true,
            onSelect: () => moveBucket('trash', 'Moved to trash'),
          },
        ]
      : [
          {
            label: 'Move to inbox',
            icon: <IconInbox size={14} />,
            onSelect: () => patch({ bucket: 'inbox' }),
          },
        ];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
          <Tooltip label="Back">
            <button type="button" aria-label="Back" className={ICON_BUTTON} onClick={() => navigate(-1)}>
              <IconChevronLeft size={16} />
            </button>
          </Tooltip>
          <span className="shrink-0 text-[13px] text-text-3 tabular-nums">#{ticket.number}</span>
          {sourceChannel && SourceGlyph && (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[12px] text-text-3"
              title={`Source: ${CHANNEL_META[sourceChannel.type].label}`}
            >
              <SourceGlyph size={12} className="shrink-0" />
              <span className="max-w-[140px] truncate">{sourceChannel.name}</span>
            </span>
          )}
          <SubjectTitle ticket={ticket} onRename={(subject) => patch({ subject })} />
          <div className="flex shrink-0 items-center gap-2">
            <SlaBadge sla={computeTicketSla(ticket, slaTargets, Date.now(), slaHours)} className="mr-1" />
            <Menu
              triggerLabel="Change status"
              triggerClassName="rounded-full transition-opacity hover:opacity-80"
              trigger={<StatusBadge status={ticket.status} />}
              items={STATUSES.map((s) => ({
                label: s.label,
                icon: s.icon,
                checked: s.value === ticket.status,
                onSelect: () => patch({ status: s.value }),
              }))}
            />
            <PriorityPill priority={ticket.priority} onSelect={(priority) => patch({ priority })} />
            <Menu
              align="end"
              triggerLabel="Assignee"
              triggerClassName="h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
              trigger={
                assignee ? (
                  <>
                    <Avatar name={assignee.name} hue={assignee.avatarHue} size={24} />
                    <span className="max-w-32 truncate">{assignee.name}</span>
                  </>
                ) : (
                  <>
                    <IconUser size={16} />
                    <span>Assign</span>
                  </>
                )
              }
              items={assigneeItems}
            />
            <Menu
              align="end"
              triggerLabel="Snooze"
              triggerClassName={ICON_BUTTON}
              trigger={<IconSnooze size={16} />}
              items={snoozeItems}
            />
            <Menu
              align="end"
              triggerLabel="More actions"
              triggerClassName={ICON_BUTTON}
              trigger={<IconDots size={16} />}
              items={kebabItems}
            />
          </div>
        </header>
        <TagsRow ticket={ticket} onPatch={patch} />
        <TriageBar key={ticket.id} ticket={ticket} />
        <Conversation ticket={ticket} />
        <Composer ticket={ticket} />
      </div>
      <ContextPanel ticket={ticket} />
    </div>
  );
}
