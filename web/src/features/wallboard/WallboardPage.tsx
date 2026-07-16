import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../data/store';
import type { Ticket } from '../../data/types';
import { formatDuration } from '../../data/supportTime';
import { Avatar } from '../../components/Avatar';
import { cx } from '../../components/util';
import { IconChevronLeft } from '../../icons';

// A big-screen, auto-refreshing team wallboard — designed to live on a TV. Every
// figure is derived from the tickets already in the store; it re-reads every few
// seconds so the room always sees the current state.

const isActive = (t: Ticket): boolean =>
  t.bucket === 'inbox' && t.mergedIntoId === null && (t.status === 'open' || t.status === 'pending' || t.status === 'on_hold');

function isToday(iso: string | null, now: Date): boolean {
  if (iso === null) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

type Tone = 'neutral' | 'accent' | 'green' | 'amber' | 'red';
const TONE: Record<Tone, string> = {
  neutral: 'var(--text)',
  accent: 'var(--accent)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
};

function Tile({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-6 min-h-[9rem]">
      <div className="text-[13px] font-semibold uppercase tracking-wider text-text-3">{label}</div>
      <div className="mt-3 font-semibold leading-none tabular-nums" style={{ color: TONE[tone], fontSize: 'clamp(2.5rem, 6vw, 4.5rem)' }}>
        {value}
      </div>
      {sub !== undefined && <div className="mt-2 text-[13px] text-text-3">{sub}</div>}
    </div>
  );
}

export function WallboardPage() {
  const tickets = useApp((s) => s.tickets);
  const agents = useApp((s) => s.agents);
  const productName = useApp((s) => s.branding.productName);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 3_000);
    return () => clearInterval(id);
  }, []);

  const m = useMemo(() => {
    const nowD = new Date(now);
    const list = Object.values(tickets);
    const active = list.filter(isActive);
    const unassigned = active.filter((t) => t.assigneeId === null);
    const awaiting = active.filter((t) => t.awaitingReply);
    const oldestWaitMs = awaiting.reduce((mx, t) => Math.max(mx, now - Date.parse(t.createdAt)), 0);
    const solvedToday = list.filter((t) => isToday(t.resolvedAt, nowD)).length;
    const ratedToday = list.filter((t) => typeof t.satisfactionScore === 'number' && isToday(t.satisfactionAt ?? null, nowD));
    const csatToday = ratedToday.length
      ? ratedToday.reduce((s, t) => s + (t.satisfactionScore ?? 0), 0) / ratedToday.length
      : null;
    const load = Object.values(agents)
      .map((a) => ({ agent: a, n: active.filter((t) => t.assigneeId === a.id).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 6);
    const maxLoad = load.reduce((mx, x) => Math.max(mx, x.n), 1);
    return {
      active: active.length,
      unassigned: unassigned.length,
      awaiting: awaiting.length,
      oldestWaitMs,
      solvedToday,
      csatToday,
      load,
      maxLoad,
    };
  }, [tickets, agents, now]);

  const clock = new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const csatTone: Tone = m.csatToday === null ? 'neutral' : m.csatToday >= 4 ? 'green' : m.csatToday >= 3 ? 'amber' : 'red';

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col px-6 py-6 sm:px-10">
        <header className="flex items-center gap-3">
          <Link to="/view/all" aria-label="Back to inbox" className="inline-flex size-9 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-surface-2 hover:text-text">
            <IconChevronLeft size={18} />
          </Link>
          <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg font-bold">{productName.charAt(0)}</div>
          <div className="min-w-0">
            <div className="text-[18px] font-semibold leading-tight">{productName}</div>
            <div className="text-[13px] text-text-3">Live wallboard</div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-text-2">
            <span aria-hidden className="size-2 animate-pulse rounded-full" style={{ background: 'var(--green)' }} />
            <span className="text-[22px] font-semibold tabular-nums">{clock}</span>
          </div>
        </header>

        <div className="mt-6 grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Open" value={String(m.active)} tone="accent" sub="active tickets" />
          <Tile label="Unassigned" value={String(m.unassigned)} tone={m.unassigned > 0 ? 'amber' : 'green'} sub="need an owner" />
          <Tile label="Awaiting reply" value={String(m.awaiting)} tone={m.awaiting > 0 ? 'amber' : 'green'} sub="customer waiting" />
          <Tile label="Oldest wait" value={m.awaiting > 0 ? formatDuration(m.oldestWaitMs) : '—'} tone={m.oldestWaitMs > 4 * 3_600_000 ? 'red' : m.oldestWaitMs > 3_600_000 ? 'amber' : 'green'} sub="longest unanswered" />
          <Tile label="Solved today" value={String(m.solvedToday)} tone="green" sub="resolved since midnight" />
          <Tile label="CSAT today" value={m.csatToday === null ? '—' : `${m.csatToday.toFixed(1)}`} tone={csatTone} sub={m.csatToday === null ? 'no ratings yet' : 'out of 5'} />
        </div>

        <section className="mt-4 rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">On it now</h2>
          {m.load.length === 0 ? (
            <p className="mt-3 text-[15px] text-text-3">No active tickets are assigned right now.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {m.load.map(({ agent, n }) => (
                <li key={agent.id} className="flex items-center gap-3">
                  <Avatar name={agent.name} hue={agent.avatarHue} size={28} />
                  <span className="w-40 shrink-0 truncate text-[15px] font-medium">{agent.name}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className={cx('h-full rounded-full')} style={{ width: `${(n / m.maxLoad) * 100}%`, background: 'var(--accent)' }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[15px] font-semibold tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
