import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useApp } from '../../data/store';
import type { Attachment, Message, Ticket } from '../../data/types';
import { attachmentUrl, formatBytes, isImage } from '../../data/attachments';
import { Avatar } from '../../components/Avatar';
import { TimeAgo } from '../../components/TimeAgo';
import { toast } from '../../components/Toast';
import { cx } from '../../components/util';
import { IconPaperclip, IconTrash } from '../../icons';

/** Renders a message body, highlighting @mentions. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z]+)/g);
  const nodes: ReactNode[] = parts.map((part, i) =>
    /^@[A-Za-z]+$/.test(part) ? (
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

  // A soft-deleted message shows a tombstone with who removed it and when.
  if (message.deletedAt) {
    const by = message.deletedBy ? (agents[message.deletedBy]?.name ?? 'an agent') : null;
    return (
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-3">
          <IconTrash size={13} />
        </span>
        <div className="min-w-0 rounded-lg rounded-tl-sm border border-dashed border-line px-3.5 py-2 text-[13px] italic text-text-3">
          Message deleted{by ? ` by ${by}` : ''} · <TimeAgo iso={message.deletedAt} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <Avatar name={name} hue={hue} size={28} className="mt-0.5" />
      <div
        onContextMenu={(e) => onContextMenu(e, message)}
        className={cx(
          'min-w-0 max-w-[85%] rounded-lg rounded-tl-sm px-3.5 py-2.5',
          isNote
            ? 'border border-transparent bg-amber-bg'
            : message.authorKind === 'contact'
              ? 'bg-surface-2'
              : 'border border-line bg-surface',
        )}
      >
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[13px] font-medium">{name}</span>
          {isNote && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber">
              Internal note
            </span>
          )}
          <TimeAgo iso={message.at} />
        </div>
        {message.body.trim() !== '' && <Body text={message.body} />}
        {message.attachments !== undefined && message.attachments.length > 0 && (
          <Attachments items={message.attachments} />
        )}
      </div>
    </div>
  );
}

export function Conversation({ ticket }: { ticket: Ticket }) {
  const messages = useApp((s) => s.messages[ticket.id]) as Message[] | undefined;
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

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} onContextMenu={openMenu} />
      ))}
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
