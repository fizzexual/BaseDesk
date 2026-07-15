import type { DatabaseSync } from 'node:sqlite';
import { rowToTicket, type TicketRow } from './db.js';
import { computeRevenue } from './deal-stats.js';
import type { Deal, Message, StatsOverview, Ticket, TicketPriority, TicketStatus } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function notSnoozed(t: Ticket, nowIso: string): boolean {
  return t.snoozedUntil === null || t.snoozedUntil <= nowIso;
}

export function computeStats(db: DatabaseSync, now: Date): StatsOverview {
  const nowIso = now.toISOString();
  const tickets = (db.prepare('SELECT * FROM tickets').all() as unknown as TicketRow[]).map(rowToTicket);
  const solvedOrClosed = tickets.filter((t) => t.status === 'solved' || t.status === 'closed');

  // Last 14 calendar days (UTC), oldest first, including today.
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    days.push(dayKey(new Date(now.getTime() - i * DAY_MS).toISOString()));
  }
  const createdByDay = new Map<string, number>(days.map((d) => [d, 0]));
  const solvedByDay = new Map<string, number>(days.map((d) => [d, 0]));
  for (const t of tickets) {
    const created = dayKey(t.createdAt);
    if (createdByDay.has(created)) createdByDay.set(created, createdByDay.get(created)! + 1);
  }
  for (const t of solvedOrClosed) {
    // Solved day approximated by updatedAt of solved/closed tickets.
    const solved = dayKey(t.updatedAt);
    if (solvedByDay.has(solved)) solvedByDay.set(solved, solvedByDay.get(solved)! + 1);
  }

  const inbox = tickets.filter((t) => t.bucket === 'inbox');
  const byPriority: Record<TicketPriority, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
  const byStatus: Record<TicketStatus, number> = { open: 0, pending: 0, on_hold: 0, solved: 0, closed: 0 };
  for (const t of inbox) {
    byPriority[t.priority] += 1;
    byStatus[t.status] += 1;
  }

  // Open/pending/on_hold inbox tickets per assignee.
  const perAgentCounts = new Map<string, number>();
  const agentIds = (db.prepare('SELECT id FROM agents ORDER BY rowid').all() as { id: string }[]).map((r) => r.id);
  for (const id of agentIds) perAgentCounts.set(id, 0);
  for (const t of inbox) {
    if (t.assigneeId !== null && ['open', 'pending', 'on_hold'].includes(t.status) && perAgentCounts.has(t.assigneeId)) {
      perAgentCounts.set(t.assigneeId, perAgentCounts.get(t.assigneeId)! + 1);
    }
  }
  const perAgentOpen = [...perAgentCounts.entries()]
    .map(([agentId, count]) => ({ agentId, count }))
    .sort((a, b) => b.count - a.count);

  // Per-agent performance accumulators. First reply is attributed to the agent who
  // actually sent it; solved / resolution / CSAT to the ticket's current assignee.
  const firstReplyByAgent = new Map<string, number[]>(agentIds.map((id) => [id, []]));
  const resolutionByAgent = new Map<string, number[]>(agentIds.map((id) => [id, []]));
  const csatByAgent = new Map<string, number[]>(agentIds.map((id) => [id, []]));
  const solvedByAgent = new Map<string, number>(agentIds.map((id) => [id, 0]));

  // Median first reply: tickets with a contact message followed by an agent reply;
  // delta = first agent reply.at - ticket.createdAt.
  const firstReplyDeltasMin: number[] = [];
  for (const t of tickets) {
    const messages = db
      .prepare('SELECT * FROM messages WHERE ticketId = ? ORDER BY at ASC, id ASC')
      .all(t.id) as unknown as Message[];
    const firstContactAt = messages.find((m) => m.authorKind === 'contact')?.at;
    if (firstContactAt === undefined) continue;
    const firstAgentReply = messages.find(
      (m) => m.authorKind === 'agent' && m.kind === 'reply' && m.at >= firstContactAt,
    );
    if (firstAgentReply === undefined) continue;
    const deltaMs = new Date(firstAgentReply.at).getTime() - new Date(t.createdAt).getTime();
    if (deltaMs >= 0) {
      const min = deltaMs / 60000;
      firstReplyDeltasMin.push(min);
      const author = firstAgentReply.authorId;
      if (author !== null && firstReplyByAgent.has(author)) firstReplyByAgent.get(author)!.push(min);
    }
  }

  // Median resolution: solved/closed tickets, updatedAt - createdAt.
  const resolutionDeltasH = solvedOrClosed
    .map((t) => (new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()) / 3600000)
    .filter((h) => h >= 0);

  // Topic volume: tags (a ticket contributes to each of its tags) and categories.
  const tagCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const t of tickets) {
    for (const tag of t.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    if (t.category !== null && t.category.trim() !== '') catCounts.set(t.category, (catCounts.get(t.category) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  const byCategory = [...catCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);

  const openNow = inbox.filter((t) => notSnoozed(t, nowIso) && t.status === 'open').length;
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const deals = db.prepare('SELECT * FROM deals').all() as unknown as Deal[];

  // Customer satisfaction over rated tickets.
  const rated = tickets.filter((t) => typeof t.satisfactionScore === 'number');
  const csat = {
    count: rated.length,
    average:
      rated.length === 0
        ? 0
        : Math.round((rated.reduce((s, t) => s + (t.satisfactionScore ?? 0), 0) / rated.length) * 10) / 10,
    positivePct:
      rated.length === 0
        ? 0
        : Math.round((rated.filter((t) => (t.satisfactionScore ?? 0) >= 4).length / rated.length) * 100),
  };

  // Attribute solved counts, resolution time and CSAT to each ticket's assignee.
  for (const t of solvedOrClosed) {
    if (t.assigneeId !== null && solvedByAgent.has(t.assigneeId)) {
      solvedByAgent.set(t.assigneeId, solvedByAgent.get(t.assigneeId)! + 1);
      const h = (new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()) / 3600000;
      if (h >= 0) resolutionByAgent.get(t.assigneeId)!.push(h);
    }
  }
  for (const t of rated) {
    if (t.assigneeId !== null && csatByAgent.has(t.assigneeId)) csatByAgent.get(t.assigneeId)!.push(t.satisfactionScore ?? 0);
  }
  const perAgentPerformance = agentIds
    .map((agentId) => {
      const fr = firstReplyByAgent.get(agentId)!;
      const cs = csatByAgent.get(agentId)!;
      return {
        agentId,
        solved: solvedByAgent.get(agentId)!,
        openLoad: perAgentCounts.get(agentId) ?? 0,
        firstReplyCount: fr.length,
        medianFirstReplyMinutes: Math.round(median(fr)),
        medianResolutionHours: Math.round(median(resolutionByAgent.get(agentId)!) * 10) / 10,
        csatCount: cs.length,
        csatAverage: cs.length === 0 ? 0 : Math.round((cs.reduce((s, v) => s + v, 0) / cs.length) * 10) / 10,
      };
    })
    .sort((a, b) => b.solved - a.solved);

  return {
    createdLast14Days: days.map((date) => ({ date, count: createdByDay.get(date)! })),
    solvedLast14Days: days.map((date) => ({ date, count: solvedByDay.get(date)! })),
    byPriority,
    byStatus,
    perAgentOpen,
    perAgentPerformance,
    topTags,
    byCategory,
    medianFirstReplyMinutes: Math.round(median(firstReplyDeltasMin)),
    medianResolutionHours: Math.round(median(resolutionDeltasH) * 10) / 10,
    openNow,
    createdLast7Days: tickets.filter((t) => t.createdAt >= sevenDaysAgo).length,
    solvedLast7Days: solvedOrClosed.filter((t) => t.updatedAt >= sevenDaysAgo).length,
    revenue: computeRevenue(deals, now),
    csat,
  };
}
