import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../data/store';
import type { Channel, Notification } from '../data/types';
import { cx } from '../components/util';
import { IconBell, IconNote, IconReply, IconUserPlus } from '../icons';

/** Friendly "from where" label for the channel a ticket arrived on. */
const CHANNEL_LABEL: Record<Channel, string> = {
  web: 'Web widget',
  chat: 'Live chat',
  email: 'Email',
  api: 'API',
};

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/** Per-kind icon, colour, and the "what happened" line ("Ada replied · via Email"). */
function describe(n: Notification): { Icon: IconComponent; tone: string; action: ReactNode } {
  switch (n.kind) {
    case 'reply':
      return {
        Icon: IconReply,
        tone: 'bg-blue-bg text-blue',
        action: (
          <>
            <span className="font-semibold">{n.actorName}</span>
            <span className="text-text-3"> replied · via {CHANNEL_LABEL[n.channel]}</span>
          </>
        ),
      };
    case 'assigned':
      return {
        Icon: IconUserPlus,
        tone: 'bg-green-bg text-green',
        action: (
          <>
            <span className="font-semibold">{n.actorName}</span>
            <span className="text-text-3"> assigned this to you</span>
          </>
        ),
      };
    case 'mention':
    default:
      return {
        Icon: IconNote,
        tone: 'bg-amber-bg text-amber',
        action: (
          <>
            <span className="font-semibold">{n.actorName}</span>
            <span className="text-text-3"> mentioned you</span>
          </>
        ),
      };
  }
}

/** Compact "3m / 2h / 4d" relative time; falls back to a date past a week. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Highlights @mentions in a snippet, matching the ticket thread renderer. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/(@[A-Za-z]+)/g).map((part, i) =>
        /^@[A-Za-z]+$/.test(part) ? (
          <span key={i} className="font-medium text-blue">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function NotificationBell() {
  const notifications = useApp((s) => s.notifications);
  const markNotificationsRead = useApp((s) => s.markNotificationsRead);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => n.readAt === null).length;

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openNotification(n: Notification) {
    setOpen(false);
    if (n.readAt === null) void markNotificationsRead(n.id).catch(() => {});
    navigate(`/ticket/${n.ticketId}`);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className={cx(
          'relative flex size-9 items-center justify-center rounded-md border border-line bg-surface text-text-2 shadow-1 transition-colors hover:border-line-2 hover:text-text',
          open && 'border-line-2 text-text',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <IconBell size={17} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg tabular-nums">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-lg border border-line bg-surface shadow-2">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <span className="text-[13px] font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="text-[12px] font-medium text-accent hover:underline"
                onClick={() => void markNotificationsRead().catch(() => {})}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-text-3">
              No notifications yet. You'll be alerted when a customer replies to your ticket or a teammate @mentions you.
            </div>
          ) : (
            <ul className="max-h-[380px] overflow-y-auto py-1">
              {notifications.map((n) => {
                const { Icon, tone, action } = describe(n);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={cx(
                        'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
                        n.readAt === null ? 'bg-surface-2 hover:bg-surface-3' : 'hover:bg-surface-2',
                      )}
                      onClick={() => openNotification(n)}
                    >
                      <span className="relative mt-0.5 shrink-0">
                        <span className={cx('flex size-7 items-center justify-center rounded-full', tone)}>
                          <Icon size={14} />
                        </span>
                        {n.readAt === null && (
                          <span
                            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-accent"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px]">{action}</span>
                          <span className="shrink-0 text-[11px] text-text-3 tabular-nums">{timeAgo(n.createdAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-text-2">{n.ticketSubject}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-text-3">
                          <Snippet text={n.snippet} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
