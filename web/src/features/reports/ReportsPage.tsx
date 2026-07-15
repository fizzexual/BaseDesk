import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { repo } from '../../data';
import { useApp } from '../../data/store';
import { slaAttainment } from '../../data/sla';
import { formatMoney } from '../../data/money';
import type { Agent, DealType, StatsOverview, TicketPriority, TicketStatus } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { Tooltip } from '../../components/Tooltip';
import { IconBook, IconChart, IconTag, IconUser } from '../../icons';
import { AreaChart } from './charts/AreaChart';
import { Donut } from './charts/Donut';
import { HBars } from './charts/HBars';
import type { HBarRow } from './charts/HBars';

const CREATED_COLOR = 'var(--blue)';
const SOLVED_COLOR = 'var(--green)';

const PRIORITY_META: { key: TicketPriority; label: string; color: string }[] = [
  { key: 'urgent', label: 'Urgent', color: 'var(--red)' },
  { key: 'high', label: 'High', color: 'var(--amber)' },
  { key: 'medium', label: 'Medium', color: 'var(--gray-dot)' },
  { key: 'low', label: 'Low', color: 'var(--green)' },
];

const STATUS_META: { key: TicketStatus; label: string; color: string }[] = [
  { key: 'open', label: 'Open', color: 'var(--blue)' },
  { key: 'pending', label: 'Pending', color: 'var(--amber)' },
  { key: 'on_hold', label: 'On hold', color: 'var(--gray-dot)' },
  { key: 'solved', label: 'Solved', color: 'var(--green)' },
  { key: 'closed', label: 'Closed', color: 'var(--text-3)' },
];

const REVENUE_TYPE_META: { key: DealType; label: string; color: string }[] = [
  { key: 'expansion', label: 'Expansion', color: 'var(--blue)' },
  { key: 'retention', label: 'Retention', color: 'var(--amber)' },
  { key: 'inbound', label: 'Inbound', color: 'var(--green)' },
];

const nf = new Intl.NumberFormat('en-US');
const money = (cents: number) => formatMoney(cents, { compact: true });

function fmtFirstReply(minutes: number): string {
  return minutes < 60 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(1)}h`;
}
function fmtResolution(hours: number): string {
  return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
}

function StatCard({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  /** Rich explainer for metrics whose meaning isn't obvious from the label alone. */
  tooltip?: { title: string; desc: string };
}) {
  return (
    <div className="min-w-0 rounded-md border border-line p-3.5">
      <div className="truncate text-[12px] font-medium text-text-3">
        {tooltip ? (
          <Tooltip title={tooltip.title} label={tooltip.desc}>
            <span>{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </div>
      <div className="mt-1 text-[20px] font-semibold tabular-nums text-text">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  aside,
  tooltip,
  children,
}: {
  title: string;
  aside?: ReactNode;
  /** Rich explainer for chart headings that use jargon. */
  tooltip?: { title: string; desc: string };
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-text">
          {tooltip ? (
            <Tooltip title={tooltip.title} label={tooltip.desc}>
              <span>{title}</span>
            </Tooltip>
          ) : (
            title
          )}
        </h2>
        {aside}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-text-2">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function ForecastCard({ stats }: { stats: StatsOverview }) {
  const historical = stats.createdLast14Days;
  const forecast = stats.forecastNext7Days;
  const combined = [...historical, ...forecast];
  const projectedTotal = forecast.reduce((s, p) => s + p.count, 0);
  const last7Actual = historical.slice(-7).reduce((s, p) => s + p.count, 0);
  const deltaPct = last7Actual === 0 ? 0 : Math.round(((projectedTotal - last7Actual) / last7Actual) * 100);
  // More incoming volume than the last week reads as caution (amber); less is a relief (green).
  const trendClass = deltaPct > 0 ? 'text-amber' : deltaPct < 0 ? 'text-green' : 'text-text-3';
  return (
    <ChartCard
      title="Ticket volume forecast"
      tooltip={{
        title: 'Forecast',
        desc: 'Projected new-ticket volume for the next 7 days, from a linear fit over the last 14. The dashed line past today is the projection.',
      }}
      aside={
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tabular-nums text-text">≈{nf.format(projectedTotal)}</span>
          <span className="text-[12px] text-text-3">next 7 days</span>
          {last7Actual > 0 && deltaPct !== 0 && (
            <span className={`text-[12px] font-medium tabular-nums ${trendClass}`}>
              {deltaPct > 0 ? '▲' : '▼'} {Math.abs(deltaPct)}% vs last 7
            </span>
          )}
        </div>
      }
    >
      <AreaChart series={[{ name: 'Tickets', color: 'var(--blue)', points: combined }]} dashFrom={historical.length - 1} />
    </ChartCard>
  );
}

function KnowledgeGaps({ stats }: { stats: StatsOverview }) {
  const kb = useApp((s) => s.kb);
  const gaps = useMemo(() => {
    const published = Object.values(kb).filter((a) => a.status === 'published');
    return stats.topTags
      .filter((t) => t.count >= 3)
      .map(({ tag, count }) => {
        const term = tag.replace(/-/g, ' ').toLowerCase();
        const covered = published.some((a) => `${a.title} ${a.category ?? ''} ${a.body}`.toLowerCase().includes(term));
        return { tag, count, covered };
      })
      .filter((g) => !g.covered)
      .slice(0, 8);
  }, [stats.topTags, kb]);

  return (
    <ChartCard
      title="Knowledge gaps"
      tooltip={{
        title: 'Knowledge gaps',
        desc: 'High-volume ticket topics with no matching published article — what to document next to deflect repeat questions.',
      }}
    >
      {gaps.length === 0 ? (
        <EmptyState icon={<IconBook size={28} />} title="Good coverage" hint="Every busy topic already has an article behind it." />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {gaps.map((g) => (
            <li key={g.tag} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className="font-medium">#{g.tag}</span>
                <span className="text-text-3"> · {nf.format(g.count)} tickets, no article</span>
              </span>
              <Link to="/kb" className="shrink-0 text-[13px] font-medium text-text-2 transition-colors hover:text-accent">
                Write one →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

const CATEGORY_COLORS = ['var(--blue)', 'var(--green)', 'var(--amber)', 'var(--gray-dot)', 'var(--red)'];

function TopicAnalytics({ stats }: { stats: StatsOverview }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-4">
      <ChartCard
        title="Top tags"
        tooltip={{ title: 'Top tags', desc: 'The most-applied tags across all tickets — a quick read on what customers are contacting you about.' }}
      >
        {stats.topTags.length === 0 ? (
          <EmptyState icon={<IconTag size={28} />} title="No tags yet" hint="Tag tickets to see topic volume here." />
        ) : (
          <HBars
            rows={stats.topTags.map((t) => ({ key: t.tag, label: `#${t.tag}`, count: t.count, color: 'var(--blue)' }))}
            labelWidth="w-32"
          />
        )}
      </ChartCard>
      <ChartCard
        title="By category"
        tooltip={{ title: 'By category', desc: 'Ticket volume per category — the topics your intake form routes tickets into.' }}
      >
        {stats.byCategory.length === 0 ? (
          <EmptyState icon={<IconTag size={28} />} title="No categories yet" hint="Categorized tickets will chart here." />
        ) : (
          <HBars
            rows={stats.byCategory.map((c, i) => ({ key: c.category, label: c.category, count: c.count, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))}
            labelWidth="w-32"
          />
        )}
      </ChartCard>
    </div>
  );
}

function AgentPerformanceTable({ stats, agents }: { stats: StatsOverview; agents: Record<string, Agent> }) {
  // Only agents with activity in the window, keeping the leaderboard focused.
  const rows = stats.perAgentPerformance.filter((p) => p.solved > 0 || p.openLoad > 0 || p.firstReplyCount > 0);
  return (
    <ChartCard
      title="Agent performance"
      tooltip={{
        title: 'Agent performance',
        desc: "Per-agent workload and quality: tickets solved and currently open (assigned to them), median first-reply and resolution time, and average CSAT.",
      }}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<IconUser size={28} />}
          title="No agent activity yet"
          hint="Solved counts, response times and CSAT will appear here per agent."
        />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-text-3">
                <th className="px-1.5 py-1.5 font-medium">Agent</th>
                <th className="px-1.5 py-1.5 text-right font-medium">Solved</th>
                <th className="px-1.5 py-1.5 text-right font-medium">Open</th>
                <th className="px-1.5 py-1.5 text-right font-medium">
                  <Tooltip title="Median first reply" label="Median time from a ticket being created to this agent's first reply, over tickets they answered first.">
                    <span>First reply</span>
                  </Tooltip>
                </th>
                <th className="px-1.5 py-1.5 text-right font-medium">
                  <Tooltip title="Median resolution" label="Median time from creation to solved, over tickets assigned to this agent.">
                    <span>Resolution</span>
                  </Tooltip>
                </th>
                <th className="px-1.5 py-1.5 text-right font-medium">CSAT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const agent = agents[p.agentId];
                if (!agent) return null;
                return (
                  <tr key={p.agentId} className="border-b border-line/60 last:border-0">
                    <td className="px-1.5 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={agent.name} hue={agent.avatarHue} size={22} />
                        <span className="truncate">{agent.name}</span>
                      </span>
                    </td>
                    <td className="px-1.5 py-2 text-right font-medium tabular-nums">{nf.format(p.solved)}</td>
                    <td className="px-1.5 py-2 text-right tabular-nums text-text-2">{nf.format(p.openLoad)}</td>
                    <td className="px-1.5 py-2 text-right tabular-nums text-text-2">
                      {p.firstReplyCount > 0 ? fmtFirstReply(p.medianFirstReplyMinutes) : '—'}
                    </td>
                    <td className="px-1.5 py-2 text-right tabular-nums text-text-2">
                      {p.medianResolutionHours > 0 ? fmtResolution(p.medianResolutionHours) : '—'}
                    </td>
                    <td className="px-1.5 py-2 text-right tabular-nums">
                      {p.csatCount > 0 ? (
                        <span>
                          <span className="text-amber">★</span> {p.csatAverage.toFixed(1)}{' '}
                          <span className="text-text-3">({p.csatCount})</span>
                        </span>
                      ) : (
                        <span className="text-text-3">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

export function ReportsPage() {
  const agents = useApp((s) => s.agents);
  const tickets = useApp((s) => s.tickets);
  const slaTargets = useApp((s) => s.sla);
  const slaHours = useApp((s) => s.slaHours);
  const sla = useMemo(() => slaAttainment(Object.values(tickets), slaTargets, slaHours), [tickets, slaTargets, slaHours]);
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repo.getStats().then(
      (s) => {
        if (!cancelled) setStats(s);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const agentRows = useMemo<HBarRow[]>(() => {
    if (!stats) return [];
    const rows: HBarRow[] = [];
    for (const { agentId, count } of stats.perAgentOpen) {
      const agent = agents[agentId];
      if (!agent) continue;
      rows.push({
        key: agentId,
        count,
        color: 'var(--blue)',
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={agent.name} hue={agent.avatarHue} size={24} />
            <span className="truncate text-[13px] text-text">{agent.name}</span>
          </span>
        ),
      });
    }
    return rows;
  }, [stats, agents]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <header className="flex items-baseline gap-2.5">
        <h1 className="text-[15px] font-semibold text-text">Reports</h1>
        <span className="text-[13px] text-text-3">Last 14 days</span>
        <Link
          to="/reports/builder"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <IconChart size={14} />
          Report builder
        </Link>
      </header>

      {failed ? (
        <EmptyState
          icon={<IconChart size={28} />}
          title="Reports unavailable"
          hint="Stats could not be loaded. Refresh to try again."
        />
      ) : stats === null ? (
        <>
          <div className="grid min-w-0 grid-cols-5 gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[280px] animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid min-w-0 grid-cols-5 gap-3">
            <StatCard label="Open now" value={nf.format(stats.openNow)} />
            <StatCard label="Created (7d)" value={nf.format(stats.createdLast7Days)} />
            <StatCard label="Solved (7d)" value={nf.format(stats.solvedLast7Days)} />
            <StatCard
              label="Median first reply"
              value={fmtFirstReply(stats.medianFirstReplyMinutes)}
              tooltip={{
                title: 'Median first reply',
                desc: "Median time between a ticket being created and the team's first reply, across all tickets.",
              }}
            />
            <StatCard
              label="Median resolution"
              value={fmtResolution(stats.medianResolutionHours)}
              tooltip={{
                title: 'Median resolution',
                desc: 'Median time from ticket creation to being marked solved, across all tickets.',
              }}
            />
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-3">
            <StatCard
              label={`First-response SLA met (${nf.format(sla.firstResponseSample)} tickets)`}
              value={`${Math.round(sla.firstResponsePct * 100)}%`}
              tooltip={{
                title: 'First-response SLA',
                desc: "Share of tickets replied to within their priority's first-response target. Counts only tickets that have received a first reply.",
              }}
            />
            <StatCard
              label={`Resolution SLA met (${nf.format(sla.resolutionSample)} tickets)`}
              value={`${Math.round(sla.resolutionPct * 100)}%`}
              tooltip={{
                title: 'Resolution SLA',
                desc: "Share of tickets resolved within their priority's resolution target. Counts only tickets that have been resolved.",
              }}
            />
          </div>

          <div className="grid min-w-0 grid-cols-3 gap-3">
            <StatCard
              label="Avg satisfaction"
              value={stats.csat.count > 0 ? `${stats.csat.average.toFixed(1)} / 5` : '—'}
              tooltip={{
                title: 'CSAT',
                desc: 'Average customer satisfaction rating across all rated tickets, 1 (worst) to 5 (best).',
              }}
            />
            <StatCard label="Positive (4–5★)" value={stats.csat.count > 0 ? `${stats.csat.positivePct}%` : '—'} />
            <StatCard label={`Ratings received`} value={nf.format(stats.csat.count)} />
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-4">
            <ChartCard
              title="Created vs solved"
              aside={
                <div className="flex items-center gap-3">
                  <LegendDot color={CREATED_COLOR} label="Created" />
                  <LegendDot color={SOLVED_COLOR} label="Solved" />
                </div>
              }
            >
              <AreaChart
                series={[
                  { name: 'Created', color: CREATED_COLOR, points: stats.createdLast14Days },
                  { name: 'Solved', color: SOLVED_COLOR, points: stats.solvedLast14Days },
                ]}
              />
            </ChartCard>

            <ChartCard title="Priority mix">
              <div className="flex h-full items-center">
                <Donut
                  segments={PRIORITY_META.map((p) => ({
                    key: p.key,
                    label: p.label,
                    value: stats.byPriority[p.key],
                    color: p.color,
                  }))}
                />
              </div>
            </ChartCard>

            <ChartCard
              title="By status"
              tooltip={{
                title: 'Ticket status',
                desc: 'Where each ticket sits in its lifecycle: Open (needs a reply), Pending (waiting on the customer), On hold (paused), Solved (resolved), or Closed (archived).',
              }}
            >
              <HBars
                rows={STATUS_META.map((s) => ({
                  key: s.key,
                  label: s.label,
                  count: stats.byStatus[s.key],
                  color: s.color,
                }))}
              />
            </ChartCard>

            <ChartCard title="Open tickets per agent">
              {agentRows.length === 0 ? (
                <EmptyState
                  icon={<IconUser size={28} />}
                  title="No assigned open tickets"
                  hint="Open tickets per agent will chart here."
                />
              ) : (
                <HBars rows={agentRows} labelWidth="w-36" />
              )}
            </ChartCard>
          </div>

          <ForecastCard stats={stats} />

          <TopicAnalytics stats={stats} />

          <KnowledgeGaps stats={stats} />

          <AgentPerformanceTable stats={stats} agents={agents} />

          <header className="mt-2 flex items-baseline gap-2.5">
            <h2 className="text-[15px] font-semibold text-text">Revenue</h2>
            <span className="text-[13px] text-text-3">Support-driven deals</span>
          </header>

          <div className="grid min-w-0 grid-cols-4 gap-3">
            <StatCard label="Won this month" value={money(stats.revenue.wonThisMonth)} />
            <StatCard
              label="Saved revenue"
              value={money(stats.revenue.savedRevenue)}
              tooltip={{
                title: 'Saved revenue',
                desc: 'Value of retention deals won this month — accounts that were at risk of churning but were kept.',
              }}
            />
            <StatCard
              label="Win rate"
              value={`${Math.round(stats.revenue.winRate * 100)}%`}
              tooltip={{
                title: 'Win rate',
                desc: "Share of closed deals (won or lost) that were won. Deals still open aren't counted.",
              }}
            />
            <StatCard
              label="Open pipeline"
              value={money(stats.revenue.openPipeline)}
              tooltip={{ title: 'Open pipeline', desc: 'Total value of deals still open — not yet won or lost.' }}
            />
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-4">
            <ChartCard
              title="Won over time"
              aside={<LegendDot color="var(--green)" label="Won" />}
            >
              <AreaChart
                formatValue={money}
                series={[
                  {
                    name: 'Won',
                    color: 'var(--green)',
                    points: stats.revenue.wonLast14Days.map((d) => ({ date: d.date, count: d.value })),
                  },
                ]}
              />
            </ChartCard>

            <ChartCard
              title="Won by type"
              tooltip={{
                title: 'Deal types',
                desc: "This month's won revenue by deal type: Expansion (upsell to an existing account), Retention (an at-risk account saved from churn), or Inbound (a new deal from a support conversation).",
              }}
            >
              <div className="flex h-full items-center">
                <Donut
                  title="Won by type"
                  formatValue={money}
                  segments={REVENUE_TYPE_META.map((t) => ({
                    key: t.key,
                    label: t.label,
                    value: stats.revenue.wonByType[t.key],
                    color: t.color,
                  }))}
                />
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
