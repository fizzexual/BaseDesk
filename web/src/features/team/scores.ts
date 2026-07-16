import type { Ticket } from '../../data/types';

// A light, gamified weekly score per agent, derived purely from ticket outcomes —
// nothing stored, so it can't drift. Points reward solving, happy customers, and
// fast first responses; badges go to the clear leaders. It's a friendly nudge, not
// a KPI, so the weighting is deliberately simple.

export interface AgentScore {
  agentId: string;
  points: number;
  solved: number;
  avgCsat: number | null;
  ratings: number;
  fastResponses: number;
  badges: string[];
}

const WEEK = 7 * 86_400_000;
const FAST_MS = 60 * 60_000; // a "fast" first response is within an hour

function award(scores: AgentScore[], badge: string, value: (s: AgentScore) => number, min: number): void {
  let best: AgentScore | null = null;
  for (const s of scores) {
    const v = value(s);
    if (v >= min && (best === null || v > value(best))) best = s;
  }
  if (best !== null) best.badges.push(badge);
}

/** Weekly leaderboard for the given agents, most points first. */
export function weeklyLeaderboard(tickets: Ticket[], agentIds: string[], nowMs: number): AgentScore[] {
  const since = nowMs - WEEK;
  const acc = new Map<string, { pts: number; solved: number; csatSum: number; ratings: number; fast: number }>();
  for (const id of agentIds) acc.set(id, { pts: 0, solved: 0, csatSum: 0, ratings: 0, fast: 0 });

  for (const t of tickets) {
    if (t.assigneeId === null) continue;
    const s = acc.get(t.assigneeId);
    if (s === undefined) continue;
    if (t.resolvedAt !== null && Date.parse(t.resolvedAt) >= since) {
      s.pts += 10;
      s.solved += 1;
    }
    if (typeof t.satisfactionScore === 'number' && t.satisfactionAt != null && Date.parse(t.satisfactionAt) >= since) {
      s.pts += (t.satisfactionScore - 3) * 4; // 5★ +8 … 3★ 0 … 1★ −8
      s.csatSum += t.satisfactionScore;
      s.ratings += 1;
    }
    if (
      t.firstRespondedAt !== null &&
      Date.parse(t.firstRespondedAt) >= since &&
      Date.parse(t.firstRespondedAt) - Date.parse(t.createdAt) <= FAST_MS
    ) {
      s.pts += 5;
      s.fast += 1;
    }
  }

  const scores: AgentScore[] = [...acc].map(([agentId, s]) => ({
    agentId,
    points: s.pts,
    solved: s.solved,
    avgCsat: s.ratings > 0 ? s.csatSum / s.ratings : null,
    ratings: s.ratings,
    fastResponses: s.fast,
    badges: [],
  }));

  award(scores, '🏆 Top solver', (s) => s.solved, 1);
  award(scores, '⚡ Fast responder', (s) => s.fastResponses, 1);
  award(scores, '⭐ Customer favourite', (s) => (s.ratings >= 2 && s.avgCsat !== null ? s.avgCsat : -1), 4);

  return scores.sort((a, b) => b.points - a.points || b.solved - a.solved);
}
