import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../../data/store';
import type { Message, Ticket } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { TimeAgo } from '../../components/TimeAgo';
import { cx } from '../../components/util';

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

function MessageRow({ message }: { message: Message }) {
  const contacts = useApp((s) => s.contacts);
  const agents = useApp((s) => s.agents);

  const author =
    message.authorKind === 'contact' ? contacts[message.authorId] : agents[message.authorId];
  const name = author?.name ?? 'Unknown';
  const hue = author?.avatarHue ?? 0;
  const isNote = message.kind === 'note';

  return (
    <div className="flex items-start gap-3">
      <Avatar name={name} hue={hue} size={28} className="mt-0.5" />
      <div
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
        <Body text={message.body} />
      </div>
    </div>
  );
}

export function Conversation({ ticket }: { ticket: Ticket }) {
  const messages = useApp((s) => s.messages[ticket.id]) as Message[] | undefined;
  const endRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  const count = messages?.length ?? 0;

  useEffect(() => {
    if (count === 0) return;
    const firstScroll = scrolledFor.current !== ticket.id;
    scrolledFor.current = ticket.id;
    endRef.current?.scrollIntoView({ block: 'end', behavior: firstScroll ? 'auto' : 'smooth' });
  }, [ticket.id, count]);

  if (messages === undefined) {
    return <div className="flex-1 overflow-y-auto px-4 py-5" />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
