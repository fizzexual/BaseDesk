import type { Deal, DealType, RevenueStats } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Revenue aggregates from the full deal set. Pure — mirrored byte-for-byte in
 * web/src/data/deal-stats.ts so the API and the local demo repository agree.
 */
export function computeRevenue(deals: Deal[], now: Date): RevenueStats {
  const nowMs = now.getTime();
  const sevenAgo = nowMs - 7 * DAY_MS;
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const closedMs = (d: Deal): number => (d.closedAt !== null ? new Date(d.closedAt).getTime() : 0);

  const won = deals.filter((d) => d.stage === 'won');
  const lost = deals.filter((d) => d.stage === 'lost');
  const open = deals.filter((d) => d.stage === 'open');
  const sum = (list: Deal[]): number => list.reduce((s, d) => s + d.value, 0);

  const wonLast7Days = sum(won.filter((d) => closedMs(d) >= sevenAgo));
  const wonThisMonth = sum(won.filter((d) => closedMs(d) >= monthStart));
  const openPipeline = sum(open);
  const savedRevenue = sum(won.filter((d) => d.type === 'retention' && closedMs(d) >= monthStart));
  const closedCount = won.length + lost.length;
  const winRate = closedCount > 0 ? won.length / closedCount : 0;

  const wonByType: Record<DealType, number> = { expansion: 0, retention: 0, inbound: 0 };
  for (const d of won) if (closedMs(d) >= monthStart) wonByType[d.type] += d.value;

  const days: string[] = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10));
  const byDay = new Map<string, { count: number; value: number }>(days.map((d) => [d, { count: 0, value: 0 }]));
  for (const d of won) {
    if (d.closedAt === null) continue;
    const bucket = byDay.get(d.closedAt.slice(0, 10));
    if (bucket !== undefined) {
      bucket.count += 1;
      bucket.value += d.value;
    }
  }
  const wonLast14Days = days.map((date) => {
    const b = byDay.get(date)!;
    return { date, count: b.count, value: b.value };
  });

  return { wonLast7Days, wonThisMonth, openPipeline, savedRevenue, winRate, wonByType, wonLast14Days };
}
