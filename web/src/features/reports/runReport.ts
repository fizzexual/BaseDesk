import type { Agent, CustomReport, ReportDimension, ReportMetric, ReportRange, Ticket } from '../../data/types';

export interface ReportRow {
  key: string;
  label: string;
  value: number;
}

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Exclude<ReportRange, 'all'>, number> = { last_7: 7, last_14: 14, last_30: 30 };

export const METRIC_LABEL: Record<ReportMetric, string> = {
  volume: 'Tickets created',
  solved: 'Tickets solved',
  resolution: 'Median resolution',
  csat: 'Average CSAT',
};
export const DIMENSION_LABEL: Record<ReportDimension, string> = {
  day: 'Day',
  agent: 'Agent',
  priority: 'Priority',
  status: 'Status',
  category: 'Category',
  tag: 'Tag',
};
export const RANGE_LABEL: Record<ReportRange, string> = {
  last_7: 'Last 7 days',
  last_14: 'Last 14 days',
  last_30: 'Last 30 days',
  all: 'All time',
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const isSolved = (t: Ticket) => t.status === 'solved' || t.status === 'closed';

function aggregate(metric: ReportMetric, tickets: Ticket[]): number {
  switch (metric) {
    case 'volume':
      return tickets.length;
    case 'solved':
      return tickets.filter(isSolved).length;
    case 'resolution': {
      const hrs = tickets
        .filter(isSolved)
        .map((t) => (Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / 3_600_000)
        .filter((h) => h >= 0);
      return Math.round(median(hrs) * 10) / 10;
    }
    case 'csat': {
      const scores = tickets.filter((t) => typeof t.satisfactionScore === 'number').map((t) => t.satisfactionScore as number);
      return scores.length === 0 ? 0 : Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
    }
  }
}

function groupKeys(dimension: ReportDimension, t: Ticket): string[] {
  switch (dimension) {
    case 'day':
      return [t.createdAt.slice(0, 10)];
    case 'agent':
      return [t.assigneeId ?? '__unassigned'];
    case 'priority':
      return [t.priority];
    case 'status':
      return [t.status];
    case 'category':
      return [t.category && t.category.trim() !== '' ? t.category : '__uncategorized'];
    case 'tag':
      return t.tags.length > 0 ? t.tags : ['__untagged'];
  }
}

function labelFor(dimension: ReportDimension, key: string, agents: Record<string, Agent>): string {
  if (key === '__unassigned') return 'Unassigned';
  if (key === '__uncategorized') return 'Uncategorized';
  if (key === '__untagged') return 'No tags';
  switch (dimension) {
    case 'agent':
      return agents[key]?.name ?? 'Unknown agent';
    case 'priority':
    case 'status':
      return key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' ');
    case 'tag':
      return `#${key}`;
    case 'day':
      return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    default:
      return key;
  }
}

/** Formats a metric value for display (durations and scores get units). */
export function formatMetricValue(metric: ReportMetric, value: number): string {
  if (metric === 'resolution') return value < 24 ? `${value}h` : `${Math.round((value / 24) * 10) / 10}d`;
  if (metric === 'csat') return value === 0 ? '—' : value.toFixed(1);
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Run a saved report config over the current tickets. Metrics come from ticket
 * fields only (no messages), so this runs entirely client-side over the store.
 * For the "day" dimension over a fixed range every day is included (zero-filled).
 */
export function runReport(config: CustomReport, tickets: Ticket[], agents: Record<string, Agent>): ReportRow[] {
  const now = Date.now();
  const cutoff = config.range === 'all' ? 0 : now - RANGE_DAYS[config.range] * DAY_MS;
  const scoped = tickets.filter((t) => Date.parse(t.createdAt) >= cutoff);

  const groups = new Map<string, Ticket[]>();
  for (const t of scoped) {
    for (const key of groupKeys(config.dimension, t)) {
      const arr = groups.get(key) ?? [];
      arr.push(t);
      groups.set(key, arr);
    }
  }

  // Zero-fill every day in a fixed range so the trend has no gaps.
  if (config.dimension === 'day' && config.range !== 'all') {
    const days = RANGE_DAYS[config.range];
    for (let i = 0; i < days; i++) {
      const key = new Date(now - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
    }
  }

  const rows: ReportRow[] = [...groups.entries()].map(([key, ts]) => ({
    key,
    label: labelFor(config.dimension, key, agents),
    value: aggregate(config.metric, ts),
  }));

  if (config.dimension === 'day') rows.sort((a, b) => a.key.localeCompare(b.key));
  else rows.sort((a, b) => b.value - a.value);
  return rows;
}
