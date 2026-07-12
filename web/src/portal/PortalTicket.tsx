import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { portalApi, type PortalMessage } from './api';
import { usePortal } from './store';
import { playNotification } from './sound';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { cx } from '../components/util';
import type { Ticket } from '../data/types';
import { IconChevronLeft } from '../icons';

function Bubble({ message, entering = false }: { message: PortalMessage; entering?: boolean }) {
  const mine = message.authorKind === 'contact';
  // Live-arrived agent replies fade and slide in once and carry a brief highlight
  // ring; first-load and own messages render statically (entering stays false).
  const [revealed, setRevealed] = useState(!entering);
  useEffect(() => {
    if (!entering) return;
    const raf = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(raf);
  }, [entering]);

  return (
    <div className={cx('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className="mb-1 flex items-center gap-2 px-1">
        <span className="text-[12px] font-medium">{mine ? 'You' : message.authorName}</span>
        <TimeAgo iso={message.at} className="text-[11px] text-text-3" />
      </div>
      <div
        className={cx(
          'max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[14px] leading-relaxed transition duration-500 ease-out',
          mine ? 'bg-accent text-accent-fg' : 'border border-line bg-surface',
          entering && 'ring-2 ring-blue/40',
          revealed ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
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
  // Ids of messages arriving live right now — they get a short highlight ring.
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());

  // Message ids already on screen, so a poll can tell which ones are new. Kept in
  // a ref (not state) so the polling closure always reads the latest set.
  const seenRef = useRef<Set<string>>(new Set());
  const pollingRef = useRef(false); // guards against overlapping polls
  const loadedRef = useRef(false); // true once the first snapshot has landed
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]); // pending highlight-clear timers

  // Fold a fresh snapshot into state. `sound` is false for the first load and the
  // customer's own replies, so the chime and highlight only fire for agent replies
  // that arrive while the customer is watching the thread.
  function apply(data: { ticket: Ticket; messages: PortalMessage[] }, sound: boolean) {
    const seen = seenRef.current;
    const inbound = data.messages.filter((m) => !seen.has(m.id) && m.authorKind === 'agent');
    setTicket(data.ticket);
    setMessages(data.messages);
    setState('ready');
    seenRef.current = new Set(data.messages.map((m) => m.id));

    if (sound && loadedRef.current && inbound.length > 0) {
      playNotification();
      const ids = inbound.map((m) => m.id);
      setHighlightIds((prev) => new Set([...prev, ...ids]));
      const timer = setTimeout(() => {
        setHighlightIds((prev) => {
          const next = new Set(prev);
          for (const mid of ids) next.delete(mid);
          return next;
        });
      }, 1600);
      timersRef.current.push(timer);
    }
    loadedRef.current = true;
  }

  async function load() {
    try {
      apply(await portalApi.getTicket(id), false);
    } catch {
      if (!loadedRef.current) setState('error');
    }
  }

  // Initial load plus live polling for this ticket: every 5s while the tab is
  // visible, with an immediate refetch when it becomes visible again. Overlapping
  // requests are guarded, and all timers are cleared on unmount / ticket change.
  useEffect(() => {
    seenRef.current = new Set();
    loadedRef.current = false;
    setHighlightIds(new Set());
    setState('loading');
    void load();

    async function poll() {
      if (pollingRef.current || document.visibilityState === 'hidden') return;
      pollingRef.current = true;
      try {
        apply(await portalApi.getTicket(id), true);
      } catch {
        // Transient failure — keep the current view and try again next tick.
      } finally {
        pollingRef.current = false;
      }
    }

    const interval = setInterval(() => void poll(), 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    };
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
          <Bubble key={m.id} message={m} entering={highlightIds.has(m.id)} />
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
