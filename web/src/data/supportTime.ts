import type { Ticket } from './types';

// Two derived support-time clocks, computed purely from a ticket's existing
// timestamps — no stored counters to drift out of sync:
//   • Total-support time runs from when the ticket was opened (createdAt).
//   • Agent-support time runs from the first agent reply (firstRespondedAt).
// Both freeze the moment the ticket is solved/closed (at resolvedAt) and resume
// counting if it is reopened.

export interface SupportTimers {
  totalMs: number; // opened → close/now
  agentMs: number | null; // first agent reply → close/now; null until an agent has replied
  running: boolean; // true while the ticket isn't solved/closed
}

export function supportTimers(t: Ticket, nowMs: number): SupportTimers {
  const terminal = t.status === 'solved' || t.status === 'closed';
  // Freeze at the resolution time when closed; otherwise the clock is live.
  const stopMs = terminal && t.resolvedAt !== null ? Date.parse(t.resolvedAt) : nowMs;
  const totalMs = Math.max(0, stopMs - Date.parse(t.createdAt));
  const agentMs = t.firstRespondedAt !== null ? Math.max(0, stopMs - Date.parse(t.firstRespondedAt)) : null;
  return { totalMs, agentMs, running: !terminal };
}

/** Compact human duration, at most two units: "45s", "12m", "2h 14m", "3d 5h". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}
