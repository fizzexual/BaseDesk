import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { portalApi, type PortalMessage, type PortalSupport } from './api';
import { usePortal } from './store';
import { playNotification } from './sound';
import { Skeleton } from './Skeleton';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { toast } from '../components/Toast';
import { cx } from '../components/util';
import { attachmentUrl, formatBytes, isImage } from '../data/attachments';
import type { Attachment, ChoicePrompt, KbCitation, Ticket } from '../data/types';
import { CitationPassage } from '../features/kb/CitationPassage';
import { IconBook, IconCheckCircle, IconChevronLeft, IconClock, IconList, IconPaperclip, IconPlus, IconX } from '../icons';

/** Friendly "by 3:45 PM today" / "by Mon, Jul 20, 3:45 PM" for an expected-reply time. */
function formatExpected(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `by ${time} today`;
  return `by ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

const MAX_UPLOAD = 10 * 1024 * 1024; // keep in step with the server

/** Renders a message's attachments: images inline, everything else a download chip. */
function PortalAttachments({ items }: { items: Attachment[] }) {
  return (
    <div className="mt-1.5 flex max-w-[85%] flex-wrap gap-2">
      {items.map((a) =>
        isImage(a) ? (
          <a
            key={a.id}
            href={attachmentUrl(a)}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-line"
          >
            <img src={attachmentUrl(a)} alt={a.filename} className="max-h-40 max-w-[220px] object-cover" />
          </a>
        ) : (
          <a
            key={a.id}
            href={attachmentUrl(a)}
            target="_blank"
            rel="noreferrer"
            download={a.filename}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] transition-colors hover:bg-surface-2"
          >
            <IconPaperclip size={13} className="shrink-0 text-text-3" />
            <span className="max-w-[160px] truncate font-medium">{a.filename}</span>
            <span className="tabular-nums text-text-3">{formatBytes(a.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

/** A cited help-article passage shown to the customer, with any agent highlights. */
function PortalCitation({ c }: { c: KbCitation }) {
  return (
    <div className="w-full max-w-[85%] overflow-hidden rounded-lg border border-line bg-surface lg:max-w-[46rem]">
      <div className="flex items-start gap-2 px-3 py-2">
        <IconBook size={14} className="mt-0.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Help article{c.category !== null ? ` · ${c.category}` : ''}
          </span>
          <span className="mt-0.5 block text-[13px] font-medium">{c.title}</span>
        </span>
      </div>
      <blockquote className="border-t border-line px-3 py-2 text-[13px] leading-relaxed text-text-2">
        “<CitationPassage passage={c.passage} highlights={c.highlights} />”
      </blockquote>
    </div>
  );
}

/** An interactive choice prompt the customer answers by tapping a button or picking from a dropdown. */
function PortalChoicePrompt({
  ticketId,
  messageId,
  embedIndex,
  prompt,
  onAnswered,
}: {
  ticketId: string;
  messageId: string;
  embedIndex: number;
  prompt: ChoicePrompt;
  onAnswered: () => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState('');
  const answered = prompt.answer != null;
  const chosen = new Set(prompt.answer?.optionIds ?? []);
  const locked = answered || submitting;
  const qId = `choice-${messageId}-${embedIndex}`;

  async function choose(optionId: string) {
    if (locked || optionId === '') return;
    setSubmitting(true);
    try {
      await portalApi.answerChoice(ticketId, messageId, embedIndex, [optionId]);
      await onAnswered();
    } catch {
      toast('Could not submit your choice');
    } finally {
      // Always clear the in-flight flag; once answered, `locked` stays true via prompt.answer.
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-[85%] rounded-lg border border-line bg-surface px-3.5 py-2.5 lg:max-w-[46rem]">
      <div className="flex items-center gap-2">
        <IconList size={14} className="shrink-0 text-accent" />
        <p id={qId} className="text-[14px] font-medium">{prompt.question}</p>
      </div>
      {prompt.layout === 'buttons' ? (
        <div role="group" aria-labelledby={qId} className="mt-2 flex flex-wrap gap-1.5">
          {prompt.options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={locked}
              onClick={() => void choose(o.id)}
              className={cx(
                'rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors',
                chosen.has(o.id)
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-line hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <select
            aria-labelledby={qId}
            disabled={locked}
            value={answered ? [...chosen][0] ?? '' : selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[13px] outline-none disabled:opacity-60"
          >
            <option value="" disabled>
              Choose…
            </option>
            {prompt.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {!answered && (
            <Button size="sm" disabled={selected === '' || submitting} onClick={() => void choose(selected)}>
              Send
            </Button>
          )}
        </div>
      )}
      {answered && <p className="mt-1.5 text-[12px] text-text-3">Thanks — we got your answer.</p>}
    </div>
  );
}

function Bubble({
  message,
  entering = false,
  ticketId,
  onAnswered,
}: {
  message: PortalMessage;
  entering?: boolean;
  ticketId: string;
  onAnswered: () => void | Promise<void>;
}) {
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
    <div className={cx('flex items-start gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
      <Avatar name={message.authorName} hue={message.avatarHue} size={28} className="mt-0.5" />
      <div className={cx('flex min-w-0 flex-1 flex-col', mine ? 'items-end' : 'items-start')}>
        <div className="mb-1 flex items-center gap-2 px-1">
          <span className="text-[12px] font-medium">{mine ? 'You' : message.authorName}</span>
          <TimeAgo iso={message.at} className="text-[11px] text-text-3" />
        </div>
        {message.body.trim() !== '' && (
          <div
            className={cx(
              'max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[14px] leading-relaxed transition duration-500 ease-out lg:max-w-[46rem]',
              mine ? 'bg-accent text-accent-fg' : 'border border-line bg-surface',
              entering && 'ring-2 ring-blue/40',
              revealed ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
            )}
          >
            {message.body}
          </div>
        )}
        {message.embeds !== undefined && message.embeds.length > 0 && (
          <div className={cx('mt-2 flex w-full flex-col gap-2', mine ? 'items-end' : 'items-start')}>
            {message.embeds.map((e, i) =>
              e.type === 'kb_citation' ? (
                <PortalCitation key={`${e.articleId}-${i}`} c={e} />
              ) : (
                <PortalChoicePrompt
                  key={`prompt-${i}`}
                  ticketId={ticketId}
                  messageId={message.id}
                  embedIndex={i}
                  prompt={e}
                  onAnswered={onAnswered}
                />
              ),
            )}
          </div>
        )}
        {message.attachments.length > 0 && <PortalAttachments items={message.attachments} />}
      </div>
    </div>
  );
}

// Content-shaped placeholder shown while the first ticket snapshot loads, mirroring
// the real header / thread / composer so nothing jumps when the data lands.
function TicketSkeleton() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
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

function Star({ filled, size = 20 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={filled ? 'text-amber' : 'text-line-2'}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

/** CSAT prompt shown on a solved/closed ticket — five stars plus an optional note. */
function RatingCard({ ticket, onRated }: { ticket: Ticket; onRated: (t: Ticket) => void }) {
  const [hover, setHover] = useState(0);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (typeof ticket.satisfactionScore === 'number') {
    return (
      <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-center">
        <p className="text-[13px] font-medium">Thanks for rating your support</p>
        <div className="mt-2 flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} filled={n <= (ticket.satisfactionScore ?? 0)} />
          ))}
        </div>
        {ticket.satisfactionComment && (
          <p className="mt-2 text-[13px] italic text-text-2">“{ticket.satisfactionComment}”</p>
        )}
      </div>
    );
  }

  async function submit() {
    if (score < 1 || busy) return;
    setBusy(true);
    try {
      const { ticket: updated } = await portalApi.rate(ticket.id, score, comment.trim());
      onRated(updated);
      toast('Thanks for your feedback!');
    } catch {
      toast('Could not submit your rating');
    } finally {
      setBusy(false);
    }
  }

  const shown = hover || score;
  return (
    <div className="mt-6 rounded-lg border border-line bg-surface p-4">
      <p className="text-center text-[14px] font-medium">How was our support?</p>
      <div className="mt-3 flex justify-center gap-1.5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className="rounded-sm p-0.5 transition-transform hover:scale-110"
            onMouseEnter={() => setHover(n)}
            onClick={() => setScore(n)}
          >
            <Star filled={n <= shown} size={26} />
          </button>
        ))}
      </div>
      {score > 0 && (
        <div className="mt-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Add a comment (optional)"
            className="w-full resize-y rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none placeholder:text-text-3"
          />
          <div className="mt-2 flex justify-center">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit rating'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ticket detail + read-receipt panel. Rendered in the desktop right sidebar and,
 *  on narrow screens, as a card at the top of the conversation. */
function TicketSidebar({
  ticket,
  support,
  lastCustomerAt,
}: {
  ticket: Ticket;
  support: PortalSupport[];
  lastCustomerAt: string | null;
}) {
  return (
    <>
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Ticket details</h2>
      <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-3">Priority</dt>
          <dd className="font-medium capitalize">{ticket.priority}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-3">Opened</dt>
          <dd className="text-text-2">
            <TimeAgo iso={ticket.createdAt} />
          </dd>
        </div>
        {ticket.category !== null && ticket.category !== '' && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-3">Category</dt>
            <dd className="font-medium">{ticket.category}</dd>
          </div>
        )}
      </dl>

      {support.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Your support team</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {support.map((s) => {
              const sawLatest = lastCustomerAt !== null && s.seenAt !== null && s.seenAt >= lastCustomerAt;
              return (
                <li key={s.name} className="flex items-center gap-2.5">
                  <Avatar name={s.name} hue={s.avatarHue} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.name}</div>
                    <div className="text-[11px] text-text-3">
                      {s.seenAt === null ? (
                        "Hasn't opened this yet"
                      ) : sawLatest ? (
                        'Seen your latest message'
                      ) : (
                        <>Last viewed <TimeAgo iso={s.seenAt} /></>
                      )}
                    </div>
                  </div>
                  {sawLatest && <IconCheckCircle size={15} className="shrink-0 text-green" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

/** Left rail (Messenger-style): the customer's other tickets, so they can hop
 *  between conversations without leaving the thread. Hidden below xl. */
function TicketListPanel({ activeId }: { activeId: string }) {
  const tickets = usePortal((s) => s.tickets);
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-r border-line xl:flex">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Your tickets</h2>
        <Link
          to="/portal/new"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <IconPlus size={13} />
          New
        </Link>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {tickets.map((t) => {
          const active = t.id === activeId;
          return (
            <li key={t.id}>
              <Link
                to={`/portal/ticket/${t.id}`}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'block rounded-lg px-3 py-2.5 transition-colors',
                  active ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className={cx('min-w-0 flex-1 truncate text-[13px]', active ? 'font-semibold' : 'font-medium')}>
                    {t.subject}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-3">#{t.number}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[12px] text-text-3">{t.lastMessagePreview}</p>
                  <TimeAgo iso={t.lastMessageAt} className="shrink-0 text-[11px] text-text-3" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export function PortalTicket() {
  const { id = '' } = useParams();
  const refreshTickets = usePortal((s) => s.refreshTickets);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [support, setSupport] = useState<PortalSupport[]>([]);
  const [expectedReplyAt, setExpectedReplyAt] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
  function apply(data: { ticket: Ticket; messages: PortalMessage[]; support: PortalSupport[]; expectedFirstReplyAt?: string | null }, sound: boolean) {
    const seen = seenRef.current;
    const inbound = data.messages.filter((m) => !seen.has(m.id) && m.authorKind === 'agent');
    setTicket(data.ticket);
    setMessages(data.messages);
    setSupport(data.support ?? []);
    setExpectedReplyAt(data.expectedFirstReplyAt ?? null);
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

  async function onFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD) {
          toast(`${file.name} is over 10 MB`);
          continue;
        }
        const att = await portalApi.uploadAttachment(file);
        setPending((prev) => [...prev, att]);
      }
    } catch {
      toast('Could not upload the file');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function send() {
    const text = reply.trim();
    if ((text === '' && pending.length === 0) || sending) return;
    setSending(true);
    try {
      await portalApi.reply(id, text, pending.map((a) => a.id));
      toast('Reply sent');
      setReply('');
      setPending([]);
      await load();
      await refreshTickets();
    } catch {
      // keep the text + attachments so the customer can retry
    } finally {
      setSending(false);
    }
  }

  const closed = ticket?.status === 'closed';
  // "Seen your latest message" is measured against the customer's most recent reply.
  const lastCustomerAt = [...messages].reverse().find((m) => m.authorKind === 'contact')?.at ?? null;

  let body: ReactNode;
  if (state === 'loading') {
    body = (
      <div className="min-w-0 flex-1 overflow-y-auto">
        <TicketSkeleton />
      </div>
    );
  } else if (state === 'error' || ticket === null) {
    body = (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="text-[14px] text-text-2">We couldn't find that ticket.</p>
        <Link to="/portal" className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">
          Back to your tickets
        </Link>
      </div>
    );
  } else {
    body = (
      <>
        {/* Conversation — a header bar, the scrolling thread, and a composer pinned to the bottom */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-line px-4 py-4 sm:px-6 lg:px-8">
            <Link to="/portal" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-text">
              <IconChevronLeft size={15} />
              All tickets
            </Link>
            <div className="mt-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-[18px] font-semibold">{ticket.subject}</h1>
                <p className="mt-0.5 text-[12px] text-text-3">Ticket #{ticket.number}</p>
              </div>
              <StatusBadge status={ticket.status} tooltip />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            {/* While the customer is still waiting on a first reply, tell them when to expect one. */}
            {expectedReplyAt !== null && (
              <div className="mb-5 flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13px] text-text-2">
                <IconClock size={15} className="shrink-0 text-text-3" />
                <span>
                  Our team aims to reply <span className="font-medium text-text">{formatExpected(expectedReplyAt)}</span>.
                </span>
              </div>
            )}
            {/* On narrow screens the sidebar collapses into a card above the thread. */}
            <div className="mb-5 rounded-lg border border-line bg-surface p-4 lg:hidden">
              <TicketSidebar ticket={ticket} support={support} lastCustomerAt={lastCustomerAt} />
            </div>

            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <Bubble key={m.id} message={m} entering={highlightIds.has(m.id)} ticketId={id} onAnswered={load} />
              ))}
            </div>
            {/* Scroll target that keeps the newest message in view (see the effect above). */}
            <div ref={bottomRef} aria-hidden />

            {(ticket.status === 'solved' || ticket.status === 'closed') && (
              <RatingCard ticket={ticket} onRated={setTicket} />
            )}
          </div>

          <div className="shrink-0 border-t border-line bg-surface px-4 py-3 sm:px-6 lg:px-8">
            {closed ? (
              <p className="py-2 text-center text-[13px] text-text-3">This ticket is closed. Open a new ticket if you still need help.</p>
            ) : (
              <div className="rounded-lg border border-line bg-bg p-2.5">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Write a reply…"
                  className="w-full resize-none bg-transparent px-1 py-1 text-[14px] outline-none placeholder:text-text-3"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                {pending.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {pending.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5 rounded-md border border-line bg-surface py-1 pl-2 pr-1 text-[12px]">
                        <IconPaperclip size={12} className="shrink-0 text-text-3" />
                        <span className="max-w-[160px] truncate font-medium">{a.filename}</span>
                        <span className="tabular-nums text-text-3">{formatBytes(a.size)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${a.filename}`}
                          onClick={() => setPending((prev) => prev.filter((x) => x.id !== a.id))}
                          className="rounded-sm p-0.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text"
                        >
                          <IconX size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
                <div className="mt-1.5 flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <IconPaperclip size={14} />
                    {uploading ? 'Uploading…' : 'Attach'}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={(reply.trim() === '' && pending.length === 0) || sending}
                    onClick={() => void send()}
                  >
                    {sending ? 'Sending…' : 'Send reply'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Real right sidebar — full height, ticket details + who's helping and what they've seen */}
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line lg:block">
          <div className="px-5 py-6">
            <TicketSidebar ticket={ticket} support={support} lastCustomerAt={lastCustomerAt} />
          </div>
        </aside>
      </>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px]">
      <TicketListPanel activeId={id} />
      {body}
    </div>
  );
}
