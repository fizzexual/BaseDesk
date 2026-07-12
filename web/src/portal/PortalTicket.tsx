import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { portalApi, type PortalMessage } from './api';
import { usePortal } from './store';
import { playNotification } from './sound';
import { Skeleton } from './Skeleton';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { toast } from '../components/Toast';
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

// Content-shaped placeholder shown while the first ticket snapshot loads, mirroring
// the real header / thread / composer so nothing jumps when the data lands.
function TicketSkeleton() {
  return (
    <section>
      <span className="sr-only">Loading ticket</span>
      <Skeleton className="h-4 w-24" />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="mt-2 h-3.5 w-24" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col items-start gap-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-16 w-3/5 rounded-lg" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-2/5 rounded-lg" />
        </div>
        <div className="flex flex-col items-start gap-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-14 w-1/2 rounded-lg" />
        </div>
      </div>
      <Skeleton className="mt-6 h-24 w-full rounded-lg" />
    </section>
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
  const bottomRef = useRef<HTMLDivElement>(null); // sentinel below the last message
  const msgCountRef = useRef(0); // messages shown last scroll, so we only chase new ones

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
    msgCountRef.current = 0; // a fresh thread should hard-jump to the bottom, not smooth-scroll
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

  // Keep the newest message in view. The count only grows when a message actually
  // arrives (a poll that changes nothing leaves it untouched), so we don't yank the
  // page while the customer is reading. First paint jumps instantly; later arrivals
  // — agent replies or the customer's own send — glide in smoothly.
  useEffect(() => {
    if (state !== 'ready') return;
    if (messages.length <= msgCountRef.current) return;
    const behavior: ScrollBehavior = msgCountRef.current === 0 ? 'auto' : 'smooth';
    msgCountRef.current = messages.length;
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, [messages, state]);

  async function send() {
    const text = reply.trim();
    if (text === '' || sending) return;
    setSending(true);
    try {
      await portalApi.reply(id, text);
      toast('Reply sent');
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
    return <TicketSkeleton />;
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
      {/* Scroll target that keeps the newest message in view (see the effect above). */}
      <div ref={bottomRef} aria-hidden />

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
