import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { portalApi, type PortalMessage } from './api';
import { usePortal } from './store';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { cx } from '../components/util';
import type { Ticket } from '../data/types';
import { IconChevronLeft } from '../icons';

function Bubble({ message }: { message: PortalMessage }) {
  const mine = message.authorKind === 'contact';
  return (
    <div className={cx('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className="mb-1 flex items-center gap-2 px-1">
        <span className="text-[12px] font-medium">{mine ? 'You' : message.authorName}</span>
        <TimeAgo iso={message.at} className="text-[11px] text-text-3" />
      </div>
      <div
        className={cx(
          'max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[14px] leading-relaxed',
          mine ? 'bg-accent text-accent-fg' : 'border border-line bg-surface',
        )}
      >
        {message.body}
      </div>
    </div>
  );
}

export function PortalTicket() {
  const { id = '' } = useParams();
  const refreshTickets = usePortal((s) => s.refreshTickets);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      const data = await portalApi.getTicket(id);
      setTicket(data.ticket);
      setMessages(data.messages);
      setState('ready');
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function send() {
    const text = reply.trim();
    if (text === '' || sending) return;
    setSending(true);
    try {
      await portalApi.reply(id, text);
      setReply('');
      await load();
      await refreshTickets();
    } catch {
      // keep the text so the customer can retry
    } finally {
      setSending(false);
    }
  }

  if (state === 'loading') {
    return <div className="py-16 text-center text-[13px] text-text-3">Loading…</div>;
  }
  if (state === 'error' || ticket === null) {
    return (
      <div className="py-16 text-center">
        <p className="text-[14px] text-text-2">We couldn't find that ticket.</p>
        <Link to="/portal" className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">
          Back to your tickets
        </Link>
      </div>
    );
  }

  const closed = ticket.status === 'closed';

  return (
    <section>
      <Link to="/portal" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-text">
        <IconChevronLeft size={15} />
        All tickets
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold">{ticket.subject}</h1>
          <p className="mt-1 text-[13px] text-text-3">Ticket #{ticket.number}</p>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-line bg-surface p-3">
        {closed ? (
          <p className="py-2 text-center text-[13px] text-text-3">This ticket is closed. Open a new ticket if you still need help.</p>
        ) : (
          <>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              placeholder="Write a reply…"
              className="w-full resize-y bg-transparent px-1 py-1 text-[14px] outline-none placeholder:text-text-3"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="mt-2 flex justify-end">
              <Button variant="primary" size="sm" disabled={reply.trim() === '' || sending} onClick={() => void send()}>
                {sending ? 'Sending…' : 'Send reply'}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
