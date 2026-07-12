import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { repo } from '../../data';
import { useApp } from '../../data/store';
import { slaAttainment } from '../../data/sla';
import { formatMoney } from '../../data/money';
import type { DealType, StatsOverview, TicketPriority, TicketStatus } from '../../data/types';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { IconChart, IconUser } from '../../icons';
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line p-3.5">
      <div className="truncate text-[12px] font-medium text-text-3">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tabular-nums text-text">{value}</div>
    </div>
  );
}

function ChartCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-text">{title}</h2>
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
            <StatCard label="Median first reply" value={fmtFirstReply(stats.medianFirstReplyMinutes)} />
            <StatCard label="Median resolution" value={fmtResolution(stats.medianResolutionHours)} />
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-3">
            <StatCard
              label={`First-response SLA met (${nf.format(sla.firstResponseSample)} tickets)`}
              value={`${Math.round(sla.firstResponsePct * 100)}%`}
            />
            <StatCard
              label={`Resolution SLA met (${nf.format(sla.resolutionSample)} tickets)`}
              value={`${Math.round(sla.resolutionPct * 100)}%`}
            />
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

            <ChartCard title="By status">
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

          <header className="mt-2 flex items-baseline gap-2.5">
            <h2 className="text-[15px] font-semibold text-text">Revenue</h2>
            <span className="text-[13px] text-text-3">Support-driven deals</span>
          </header>

          <div className="grid min-w-0 grid-cols-4 gap-3">
            <StatCard label="Won this month" value={money(stats.revenue.wonThisMonth)} />
            <StatCard label="Saved revenue" value={money(stats.revenue.savedRevenue)} />
            <StatCard label="Win rate" value={`${Math.round(stats.revenue.winRate * 100)}%`} />
            <StatCard label="Open pipeline" value={money(stats.revenue.openPipeline)} />
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

            <ChartCard title="Won by type">
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
