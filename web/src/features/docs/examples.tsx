import type { ReactNode } from 'react';
import { Markdown } from '../kb/Markdown';
import { Avatar } from '../../components/Avatar';
import { OutsideHoursCard } from '../ticket/OutsideHoursCard';
import type { OutsideHours } from '../../data/types';
import { IconBook, IconClock, IconMerge, IconX } from '../../icons';

// Built-in, live example mockups for the System Guide. Where a real component can
// stand in with sample props it does (e.g. OutsideHoursCard); the rest are small,
// token-styled mocks. Each renders inside a Frame at a {{example:key}} placeholder.

/** A screenshot-style window frame around an example, with an optional caption. */
function Frame({ title, caption, children }: { title?: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="my-5 overflow-hidden rounded-xl border border-line bg-surface shadow-1">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-line-2" />
          <span className="size-2.5 rounded-full bg-line-2" />
          <span className="size-2.5 rounded-full bg-line-2" />
        </span>
        {title !== undefined && <span className="ml-1 text-[12px] font-medium text-text-3">{title}</span>}
      </div>
      <div className="bg-bg p-4">{children}</div>
      {caption !== undefined && (
        <figcaption className="border-t border-line px-3 py-2 text-[12px] text-text-3">{caption}</figcaption>
      )}
    </figure>
  );
}

const outsideHoursSample: OutsideHours = {
  type: 'outside_hours',
  message: "Thanks for reaching out! You've caught us outside our working hours, so a reply may take a little longer.",
  nextOpenAt: new Date(Date.now() + 8 * 3_600_000 + 25 * 60_000).toISOString(),
};

interface Example {
  title: string;
  caption?: string;
  node: ReactNode;
}

export const EXAMPLES: Record<string, Example> = {
  'support-time': {
    title: 'Ticket details → Support time',
    caption: 'Both clocks tick live while the ticket is open, and freeze when it’s solved.',
    node: (
      <div className="max-w-[280px] rounded-xl border border-line bg-surface p-4">
        <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
          Support time
          <span className="size-1.5 animate-pulse rounded-full" style={{ background: 'var(--green)' }} />
        </div>
        <div className="flex items-baseline justify-between gap-2 text-[13px]">
          <span className="text-text-3">Total</span>
          <span className="font-medium tabular-nums">2h 14m</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2 text-[13px]">
          <span className="text-text-3">Agent</span>
          <span className="font-medium tabular-nums text-text-2">1h 03m</span>
        </div>
      </div>
    ),
  },
  presence: {
    title: 'Ticket header',
    caption: 'Appears when a teammate has the same ticket open.',
    node: (
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {[{ n: 'Priya Nair', h: 200 }, { n: 'Sam Reed', h: 40 }].map((a) => (
            <span key={a.n} className="rounded-full ring-2 ring-bg">
              <Avatar name={a.n} hue={a.h} size={24} />
            </span>
          ))}
        </div>
        <span className="text-[12px] font-medium" style={{ color: 'var(--amber)' }}>
          Also viewing
        </span>
      </div>
    ),
  },
  'duplicate-hint': {
    title: 'Top of a ticket',
    caption: 'Surfaces the closest-looking existing ticket so you can merge before replying.',
    node: (
      <div className="flex items-center gap-2 rounded-md bg-blue-bg px-3 py-2 text-[13px]">
        <IconMerge size={14} className="shrink-0 text-blue" />
        <span className="text-text-2">
          This ticket looks like{' '}
          <span className="font-medium text-accent">#1182 “Refund for order 5567 not received”</span> — same contact
        </span>
      </div>
    ),
  },
  'outside-hours': {
    title: 'Customer’s first message, after hours',
    caption: 'Auto-posted when a ticket opens outside business hours — with a live countdown to reopening.',
    node: <OutsideHoursCard e={outsideHoursSample} />,
  },
  scheduled: {
    title: 'Above the composer',
    caption: 'Pending scheduled sends, each cancellable, fire automatically at their time.',
    node: (
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
        <IconClock size={14} className="shrink-0 text-amber" />
        <span className="shrink-0 text-text-2">
          Reply scheduled <span className="font-medium text-text">Tomorrow, 9:00 AM</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-text-3">— Following up as promised…</span>
        <IconX size={14} className="shrink-0 text-text-3" />
      </div>
    ),
  },
  'choice-prompt': {
    title: 'A choice prompt in the portal',
    caption: 'The customer taps a button; their pick posts back into the conversation.',
    node: (
      <div className="max-w-[360px] rounded-xl border border-line bg-surface-2 p-3.5">
        <p className="mb-2.5 text-[13px] font-medium">Which plan are you on?</p>
        <div className="flex flex-wrap gap-2">
          {['Team', 'Business', 'Not sure'].map((o) => (
            <span key={o} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px]">
              {o}
            </span>
          ))}
        </div>
      </div>
    ),
  },
  citation: {
    title: 'A cited KB passage in a reply',
    caption: 'Cite an article and highlight the key words before you send.',
    node: (
      <div className="max-w-[420px] rounded-xl border border-line bg-surface-2 p-3.5 text-[13px]">
        <div className="mb-1.5 flex items-center gap-1.5 font-medium">
          <IconBook size={14} className="text-accent" />
          From “Plans &amp; pricing explained”
        </div>
        <p className="leading-relaxed text-text-2">
          Add a seat mid-cycle and you pay only the <mark className="cite-hl cite-hl-yellow">remaining days</mark> of the
          billing period.
        </p>
      </div>
    ),
  },
  'wallboard-tiles': {
    title: '/wallboard',
    caption: 'Big, auto-refreshing tiles built for a TV or second monitor.',
    node: (
      <div className="grid grid-cols-3 gap-3">
        {([['Open', '551', 'var(--accent)'], ['Awaiting', '316', 'var(--amber)'], ['CSAT today', '4.6', 'var(--green)']] as const).map(
          ([label, value, color]) => (
            <div key={label} className="rounded-xl border border-line bg-surface p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-3">{label}</div>
              <div className="mt-1 text-[28px] font-semibold leading-none tabular-nums" style={{ color }}>
                {value}
              </div>
            </div>
          ),
        )}
      </div>
    ),
  },
};

/** Render a doc body, expanding {{example:key}} placeholders into framed examples. */
export function DocBody({ text }: { text: string }) {
  const parts = text.split(/\{\{example:([a-z0-9-]+)\}\}/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const ex = EXAMPLES[part];
          return ex ? (
            <Frame key={i} title={ex.title} caption={ex.caption}>
              {ex.node}
            </Frame>
          ) : null;
        }
        return part.trim() === '' ? null : <Markdown key={i} text={part} />;
      })}
    </>
  );
}
