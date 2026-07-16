import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import type { Attachment, ChoicePrompt, KbCitation, Message, MessageEmbed, Ticket, TicketEvent } from '../../data/types';
import { attachmentUrl, formatBytes, isImage } from '../../data/attachments';
import { Avatar } from '../../components/Avatar';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../components/util';
import { IconBook, IconCheck, IconList, IconPaperclip, IconTrash } from '../../icons';
import { CitationPassage } from '../kb/CitationPassage';
import { OutsideHoursCard } from './OutsideHoursCard';
import { describeTicketEvent } from './eventText';

/** Renders a message body, highlighting @mentions. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(@\p{L}[\p{L}'’_-]*)/gu);
  const nodes: ReactNode[] = parts.map((part, i) =>
    /^@\p{L}[\p{L}'’_-]*$/u.test(part) ? (
      <span key={i} className="font-medium text-blue">
        {part}
      </span>
    ) : (
      part
    ),
  );
  return <p className="whitespace-pre-line text-[14px] leading-relaxed">{nodes}</p>;
}

/** Image previews inline; other files as downloadable chips. */
function Attachments({ items }: { items: Attachment[] }) {
  return (
    <div className={cx('flex flex-wrap gap-2', 'mt-2')}>
      {items.map((a) => {
        const url = attachmentUrl(a);
        if (isImage(a)) {
          return (
            <a key={a.id} href={url} target="_blank" rel="noreferrer" title={a.filename} className="block overflow-hidden rounded-md border border-line">
              <img src={url} alt={a.filename} className="max-h-40 max-w-[220px] object-cover" />
            </a>
          );
        }
        return (
          <a
            key={a.id}
            href={url}
            target="_blank"
            rel="noreferrer"
            download={a.filename}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] transition-colors hover:bg-surface-2"
          >
            <IconPaperclip size={14} className="shrink-0 text-text-3" />
            <span className="max-w-[180px] truncate font-medium">{a.filename}</span>
            <span className="tabular-nums text-text-3">{formatBytes(a.size)}</span>
          </a>
        );
      })}
    </div>
  );
}

/** A cited knowledge-base passage, rendered as a sourced card that links back to the article. */
function Citation({ c }: { c: KbCitation }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Link to={`/kb/${c.articleId}`} className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-surface-2">
        <IconBook size={14} className="mt-0.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Help article{c.category !== null ? ` · ${c.category}` : ''}
          </span>
          <span className="mt-0.5 block truncate text-[13px] font-medium text-accent">{c.title}</span>
        </span>
      </Link>
      <blockquote className="border-t border-line px-3 py-2 text-[13px] leading-relaxed text-text-2">
        “<CitationPassage passage={c.passage} highlights={c.highlights} />”
      </blockquote>
    </div>
  );
}

/** An agent's choice prompt as seen in the thread: read-only, with the customer's pick once answered. */
function ChoicePromptCard({ p }: { p: ChoicePrompt }) {
  const chosen = new Set(p.answer?.optionIds ?? []);
  const answered = p.answer != null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <IconList size={14} className="shrink-0 text-accent" />
        <span className="text-[13px] font-medium">{p.question}</span>
      </div>
      <div className={cx('mt-2', p.layout === 'buttons' ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-1')}>
        {p.options.map((o) => {
          const isChosen = chosen.has(o.id);
          return (
            <span
              key={o.id}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px]',
                p.layout === 'dropdown' && 'w-full',
                isChosen ? 'border-green bg-green-bg font-medium text-text' : 'border-line text-text-2',
              )}
            >
              {isChosen && <IconCheck size={12} className="shrink-0 text-green" />}
              {o.label}
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-text-3">
        {answered
          ? 'Customer answered'
          : p.layout === 'dropdown'
            ? 'Customer picks from a dropdown'
            : 'Customer taps a button to answer'}
      </p>
    </div>
  );
}

/** Structured cards attached to a message: KB citations and choice prompts. */
function Embeds({ items }: { items: MessageEmbed[] }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {items.map((e, i) =>
        e.type === 'kb_citation' ? (
          <Citation key={`${e.articleId}-${i}`} c={e} />
        ) : e.type === 'choice_prompt' ? (
          <ChoicePromptCard key={`prompt-${i}`} p={e} />
        ) : (
          <OutsideHoursCard key={`oh-${i}`} e={e} />
        ),
      )}
    </div>
  );
}

function EventRow({ event }: { event: TicketEvent }) {
  const agents = useApp((s) => s.agents);
  const actor = event.actorName ?? (event.actorId !== null ? agents[event.actorId]?.name : null) ?? 'Automation';
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-surface-2 px-3 py-1 text-[12px] text-text-3">
        <span className="font-medium text-text-2">{actor}</span> {describeTicketEvent(event, agents)} · <TimeAgo iso={event.at} />
      </span>
    </div>
  );
}

function MessageRow({
  message,
  onContextMenu,
}: {
  message: Message;
  onContextMenu: (e: MouseEvent, m: Message) => void;
}) {
  const contacts = useApp((s) => s.contacts);
  const agents = useApp((s) => s.agents);

  const author =
    message.authorKind === 'contact' ? contacts[message.authorId] : agents[message.authorId];
  const name = author?.name ?? 'Unknown';
  const hue = author?.avatarHue ?? 0;
  const isNote = message.kind === 'note';
  // Support (agents) sit on the right like your own messages in a chat app; the
  // customer sits on the left. Internal notes stay agent-side but keep amber.
  const mine = message.authorKind === 'agent';

  // A soft-deleted message shows a tombstone with who removed it and when.
  if (message.deletedAt) {
    const by = message.deletedBy ? (agents[message.deletedBy]?.name ?? 'an agent') : null;
    return (
      <div className={cx('flex items-start gap-3', mine && 'flex-row-reverse')}>
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-3">
          <IconTrash size={13} />
        </span>
        <div className="min-w-0 rounded-lg border border-dashed border-line px-3.5 py-2 text-[13px] italic text-text-3">
          Message deleted{by ? ` by ${by}` : ''} · <TimeAgo iso={message.deletedAt} />
        </div>
      </div>
    );
  }

  return (
    <div className={cx('flex items-start gap-2.5', mine && 'flex-row-reverse')}>
      <Avatar name={name} hue={hue} size={30} className="mt-0.5 shrink-0" />
      <div className={cx('flex min-w-0 max-w-[82%] flex-col', mine ? 'items-end' : 'items-start')}>
        {/* Sender + time sit on a line above the bubble (customer left, agent right). */}
        <div className="mb-1 flex items-center gap-1.5 px-0.5 text-[12px]">
          {mine ? (
            <>
              <TimeAgo iso={message.at} className="text-text-3" />
              <span className="text-text-3">·</span>
              <span className="font-medium text-text-2">{name}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-text-2">{name}</span>
              <span className="text-text-3">·</span>
              <TimeAgo iso={message.at} className="text-text-3" />
            </>
          )}
          {isNote && (
            <Tooltip title="Internal note" label="Only your team can see this — the customer is never notified.">
              <span className="ml-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber">Internal note</span>
            </Tooltip>
          )}
        </div>
        {/* Neutral dark bubble on both sides — position + avatar signal the sender. */}
        <div
          onContextMenu={(e) => onContextMenu(e, message)}
          className={cx(
            'w-fit max-w-full rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed',
            mine ? 'rounded-tr-md' : 'rounded-tl-md',
            isNote ? 'bg-amber-bg' : 'bg-surface-2',
          )}
        >
          {message.body.trim() !== '' && <Body text={message.body} />}
          {message.embeds !== undefined && message.embeds.length > 0 && <Embeds items={message.embeds} />}
          {message.attachments !== undefined && message.attachments.length > 0 && (
            <Attachments items={message.attachments} />
          )}
        </div>
      </div>
    </div>
  );
}

type TimelineItem =
  | { t: 'm'; at: string; key: string; m: Message }
  | { t: 'e'; at: string; key: string; e: TicketEvent };

export function Conversation({ ticket }: { ticket: Ticket }) {
  const messages = useApp((s) => s.messages[ticket.id]) as Message[] | undefined;
  const events = useApp((s) => s.ticketEvents[ticket.id]) as TicketEvent[] | undefined;
  const deleteMessage = useApp((s) => s.deleteMessage);
  const endRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const count = messages?.length ?? 0;

  useEffect(() => {
    if (count === 0) return;
    const firstScroll = scrolledFor.current !== ticket.id;
    scrolledFor.current = ticket.id;
    endRef.current?.scrollIntoView({ block: 'end', behavior: firstScroll ? 'auto' : 'smooth' });
  }, [ticket.id, count]);

  function closeMenu() {
    setMenu(null);
    setConfirming(false);
  }

  useEffect(() => {
    if (menu === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  function openMenu(e: MouseEvent, message: Message) {
    if (message.deletedAt) return; // nothing to act on for a tombstone
    e.preventDefault();
    setConfirming(false);
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 190), y: e.clientY, message });
  }

  function copyText() {
    if (menu === null) return;
    void navigator.clipboard
      .writeText(menu.message.body)
      .then(() => toast('Message copied'))
      .catch(() => toast('Could not copy'));
    closeMenu();
  }

  function performDelete() {
    if (menu === null) return;
    const { message } = menu;
    closeMenu();
    deleteMessage(ticket.id, message.id)
      .then(() => toast('Message deleted'))
      .catch(() => toast('Could not delete the message'));
  }

  if (messages === undefined) {
    return <div className="flex-1 overflow-y-auto px-4 py-5" />;
  }

  // Interleave messages and activity events into one time-ordered timeline.
  const items: TimelineItem[] = [
    ...messages.map((m): TimelineItem => ({ t: 'm', at: m.at, key: `m${m.id}`, m })),
    ...(events ?? []).map((e): TimelineItem => ({ t: 'e', at: e.at, key: `e${e.id}`, e })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
      {items.map((it) =>
        it.t === 'm' ? (
          <MessageRow key={it.key} message={it.m} onContextMenu={openMenu} />
        ) : (
          <EventRow key={it.key} event={it.e} />
        ),
      )}
      <div ref={endRef} />

      {menu !== null && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeMenu();
            }}
          />
          <div
            role="menu"
            className="fixed z-50 min-w-[170px] rounded-md border border-line bg-surface py-1 shadow-1"
            style={{ left: menu.x, top: menu.y }}
          >
            {confirming ? (
              <div className="px-3 py-2 text-[13px]">
                <p className="text-text-2">Delete this message?</p>
                <div className="mt-2 flex gap-3">
                  <button type="button" className="font-medium text-red hover:underline" onClick={performDelete}>
                    Delete
                  </button>
                  <button type="button" className="text-text-3 hover:text-text" onClick={closeMenu}>
                    Cancel
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-text-3">A “message deleted” note stays as proof.</p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-text-2 transition-colors hover:bg-surface-2"
                  onClick={copyText}
                >
                  Copy text
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red transition-colors hover:bg-red-bg"
                  onClick={() => setConfirming(true)}
                >
                  <IconTrash size={14} />
                  Delete message
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
