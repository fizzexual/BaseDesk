import type { ReactNode } from 'react';
import { Markdown } from '../kb/Markdown';
import { Avatar } from '../../components/Avatar';
import { OutsideHoursCard } from '../ticket/OutsideHoursCard';
import type { OutsideHours } from '../../data/types';
import { IconAlert, IconBook, IconChart, IconClock, IconInbox, IconMerge, IconPlus, IconSearch, IconSparkle, IconX } from '../../icons';

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

// Extra examples for the rest of the guide.
Object.assign(EXAMPLES, {
  'status-badges': {
    title: 'Ticket header',
    caption: 'A ticket moves through these statuses; priority sits alongside.',
    node: (
      <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium">
        {([['Open', 'var(--blue)'], ['Pending', 'var(--amber)'], ['Solved', 'var(--green)']] as const).map(([s, c]) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ color: c, background: `color-mix(in oklab, ${c} 14%, transparent)` }}>
            <span className="size-1.5 rounded-full" style={{ background: c }} />
            {s}
          </span>
        ))}
        <span className="rounded-full px-2.5 py-1" style={{ color: 'var(--red)', background: 'color-mix(in oklab, var(--red) 14%, transparent)' }}>Urgent</span>
      </div>
    ),
  },
  'command-palette': {
    title: '⌘K',
    caption: 'Jump anywhere or run an action from the keyboard.',
    node: (
      <div className="mx-auto max-w-[420px] overflow-hidden rounded-xl border border-line bg-surface shadow-2">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <IconSearch size={15} className="text-text-3" />
          <span className="text-[13px] text-text-3">Search or jump to…</span>
          <span className="ml-auto rounded border border-line px-1.5 text-[11px] text-text-3">⌘K</span>
        </div>
        <div className="p-1.5 text-[13px]">
          <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5"><IconInbox size={14} className="text-text-3" />Go to Inbox</div>
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-text-2"><IconChart size={14} className="text-text-3" />Open wallboard</div>
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-text-2"><IconPlus size={14} className="text-text-3" />New ticket</div>
        </div>
      </div>
    ),
  },
  translate: {
    title: 'A customer message',
    caption: 'Translate reads it in your language; toggle back to the original anytime.',
    node: (
      <div className="max-w-[420px] space-y-1.5 text-[13px]">
        <div className="w-fit rounded-2xl bg-surface-2 px-3.5 py-2.5">Hola, no puedo pagar mi factura, ¿me pueden ayudar?</div>
        <div className="w-fit rounded-2xl bg-blue-bg px-3.5 py-2.5 text-text">Hi, I can’t pay my invoice — can you help?</div>
        <button type="button" className="text-[12px] font-medium text-text-3">Show original (from Spanish)</button>
      </div>
    ),
  },
  'sla-badge': {
    title: 'Ticket header',
    caption: 'Each ticket shows its SLA state; it turns urgent as a target nears or is missed.',
    node: (
      <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ color: 'var(--green)', background: 'color-mix(in oklab, var(--green) 14%, transparent)' }}><IconClock size={12} />First reply in 2h</span>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ color: 'var(--red)', background: 'color-mix(in oklab, var(--red) 14%, transparent)' }}><IconAlert size={12} />Resolution overdue</span>
      </div>
    ),
  },
  csat: {
    title: 'Ticket details, after resolution',
    caption: 'Customers rate 1–5 with a comment; it rolls up into Reports and the wallboard.',
    node: (
      <div className="max-w-[280px]">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">Satisfaction</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[16px] leading-none"><span className="text-amber">★★★★</span><span className="text-line-2">★</span></span>
          <span className="text-[13px] tabular-nums text-text-2">4/5</span>
        </div>
        <p className="mt-1 text-[13px] italic text-text-2">“Fast and friendly, thanks!”</p>
      </div>
    ),
  },
  'skills-language': {
    title: 'Settings → Team',
    caption: 'Categories drive skill routing; languages route non-English tickets.',
    node: (
      <div className="space-y-3 text-[13px]">
        <div>
          <div className="mb-1.5 text-text-3">Handles categories</div>
          <div className="flex flex-wrap gap-1.5">
            {['Billing', 'Bug'].map((c) => <span key={c} className="rounded-full bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-fg">{c}</span>)}
            <span className="rounded-full border border-line px-2.5 py-1 text-[12px] text-text-2">Technical</span>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-text-3">Speaks</div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-fg">Spanish</span>
            {['English', 'French'].map((l) => <span key={l} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-text-2">{l}</span>)}
          </div>
        </div>
      </div>
    ),
  },
  'merged-banner': {
    title: 'A merged (duplicate) ticket',
    caption: 'The source keeps its own conversation and links to the ticket it merged into.',
    node: (
      <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5 text-[13px]">
        <IconMerge size={15} className="shrink-0 text-text-3" />
        <span className="text-text-2">This ticket was merged into #3520 and is read-only.</span>
        <span className="flex-1" />
        <span className="rounded-md border border-line px-2 py-1 text-[12px] font-medium">Open #3520</span>
      </div>
    ),
  },
  'canned-macro': {
    title: 'A canned reply with macro actions',
    caption: 'Inserting it can also set status, priority, or tags in one move.',
    node: (
      <div className="max-w-[360px] rounded-lg border border-line bg-surface p-2.5 text-[13px]">
        <div className="flex items-center gap-1.5 font-medium"><IconSparkle size={13} className="text-accent" />Refund processed</div>
        <div className="mt-0.5 truncate text-text-3">Your refund of {'{{amount}}'} is on its way…</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-text-3">
          <span className="rounded bg-surface-2 px-1.5 py-0.5">Set status: Solved</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5">+ tag refund</span>
        </div>
      </div>
    ),
  },
  'workload-bar': {
    title: 'Team page',
    caption: 'Each member’s current active-ticket load, so you can rebalance at a glance.',
    node: (
      <div className="max-w-[360px] space-y-2 text-[13px]">
        {([['Jonas Weber', 122, 200], ['Priya Nair', 90, 30]] as const).map(([n, val, hue]) => (
          <div key={n} className="flex items-center gap-3">
            <Avatar name={n} hue={hue} size={26} />
            <span className="w-24 truncate">{n}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${(val / 122) * 100}%`, background: 'var(--accent)' }} /></div>
            <span className="w-6 text-right tabular-nums">{val}</span>
          </div>
        ))}
      </div>
    ),
  },
  'automation-rule': {
    title: 'Settings → Automation',
    caption: 'When the conditions match a new ticket, the actions run — in order.',
    node: (
      <div className="max-w-[440px] rounded-lg border border-line bg-surface p-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-1.5"><span className="text-text-3">When</span><span className="rounded bg-surface-2 px-2 py-0.5 font-medium">Subject contains</span><span className="rounded bg-surface-2 px-2 py-0.5">“refund”</span></div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="text-text-3">Then</span><span className="rounded px-2 py-0.5 font-medium text-blue" style={{ background: 'var(--blue-bg)' }}>Set category: Billing</span><span className="rounded px-2 py-0.5 font-medium text-blue" style={{ background: 'var(--blue-bg)' }}>Add tag: refund</span></div>
      </div>
    ),
  },
  notification: {
    title: 'The notification bell',
    caption: 'Replies, assignments, and @mentions from your team.',
    node: (
      <div className="max-w-[360px] rounded-lg border border-line bg-surface p-2.5 text-[13px]">
        <div className="flex items-start gap-2">
          <Avatar name="Mel Ortiz" hue={300} size={26} />
          <div>
            <span className="font-medium">Mel Ortiz</span> mentioned you in <span className="font-medium text-accent">#1182</span>
            <div className="text-text-3">“can <span className="rounded px-1 text-blue" style={{ background: 'var(--blue-bg)' }}>@you</span> take this one?”</div>
          </div>
        </div>
      </div>
    ),
  },
  'kb-editor': {
    title: 'Knowledge base editor',
    caption: 'Write in Markdown with a live preview; Published makes an article live.',
    node: (
      <div className="max-w-[420px] overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[13px] font-medium">Body</span>
          <div className="flex rounded-md border border-line p-0.5 text-[12px]"><span className="rounded bg-surface-2 px-2 py-0.5 font-medium">Write</span><span className="px-2 py-0.5 text-text-3">Preview</span></div>
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-text-2">{'## Compare plans\n\n| Feature | Team | Business |\n| --- | --- | --- |\n| SSO | — | Yes |'}</pre>
      </div>
    ),
  },
  'channel-badges': {
    title: 'Channels',
    caption: 'Inbound messages from any connected channel become tickets.',
    node: (
      <div className="flex flex-wrap gap-2 text-[12px] font-medium text-text-2">
        {['Email', 'Web chat', 'Discord', 'Slack', 'WhatsApp', 'Webhook'].map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1"><span className="size-1.5 rounded-full" style={{ background: 'var(--green)' }} />{c}</span>
        ))}
      </div>
    ),
  },
  'deal-card': {
    title: 'Ticket details → Revenue',
    caption: 'Log opportunities against a contact right from the ticket.',
    node: (
      <div className="max-w-[320px] rounded-lg border border-line bg-surface p-3 text-[13px]">
        <div className="flex items-center gap-1.5"><span className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent" style={{ background: 'color-mix(in oklab, var(--accent) 14%, transparent)' }}>Upsell</span><span className="font-medium">Business plan upgrade</span></div>
        <div className="mt-1.5 flex items-center justify-between"><span className="tabular-nums text-text-2">$4,800</span><span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: 'var(--green)', background: 'color-mix(in oklab, var(--green) 14%, transparent)' }}>Open</span></div>
      </div>
    ),
  },
});

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
