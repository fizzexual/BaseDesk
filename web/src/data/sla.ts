import type { SlaState, SlaTargets, Ticket, TicketSla } from './types';

const MIN_MS = 60_000;

function relative(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / MIN_MS);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Classifies an active (unmet) clock by how close it is to its due time. */
function activeState(now: number, dueMs: number, windowMs: number, paused: boolean): SlaState {
  if (paused) return 'paused';
  if (now > dueMs) return 'breached';
  if (now > dueMs - windowMs * 0.25) return 'due_soon';
  return 'on_track';
}

/**
 * SLA status for a ticket against the configured targets. Returns null for
 * tickets outside the inbox (archive/spam/trash carry no SLA).
 */
export function computeTicketSla(ticket: Ticket, targets: SlaTargets, now: number): TicketSla | null {
  if (ticket.bucket !== 'inbox') return null;
  const target = targets[ticket.priority];
  const created = new Date(ticket.createdAt).getTime();
  const frWindow = target.firstResponseMins * MIN_MS;
  const resWindow = target.resolutionMins * MIN_MS;
  const frDue = created + frWindow;
  const resDue = created + resWindow;
  const resolved = ticket.status === 'solved' || ticket.status === 'closed';
  const snoozed = ticket.snoozedUntil !== null && new Date(ticket.snoozedUntil).getTime() > now;
  const paused = ticket.status === 'on_hold' || snoozed;

  // Done: both clocks settled — report whether targets were met.
  if (resolved) {
    const frMet = ticket.firstRespondedAt === null || new Date(ticket.firstRespondedAt).getTime() <= frDue;
    const resMet = ticket.resolvedAt === null || new Date(ticket.resolvedAt).getTime() <= resDue;
    const met = frMet && resMet;
    return { state: met ? 'met' : 'breached', label: met ? 'Met' : 'SLA missed', clock: 'done' };
  }

  // First-response clock is active until the first agent reply.
  if (ticket.firstRespondedAt === null) {
    const state = activeState(now, frDue, frWindow, paused);
    const label =
      state === 'paused' ? 'SLA paused'
      : state === 'breached' ? 'Reply overdue'
      : `Reply due in ${relative(frDue - now)}`;
    return { state, label, clock: 'first_response' };
  }

  // Otherwise the resolution clock is what matters.
  const state = activeState(now, resDue, resWindow, paused);
  const label =
    state === 'paused' ? 'SLA paused'
    : state === 'breached' ? 'Resolution overdue'
    : `Resolve in ${relative(resDue - now)}`;
  return { state, label, clock: 'resolution' };
}

export interface SlaAttainment {
  firstResponsePct: number; // 0..1
  resolutionPct: number;
  firstResponseSample: number;
  resolutionSample: number;
}

/** Attainment over tickets that reached each milestone (responded / resolved). */
export function slaAttainment(tickets: Ticket[], targets: SlaTargets): SlaAttainment {
  let frMet = 0;
  let frTotal = 0;
  let resMet = 0;
  let resTotal = 0;
  for (const t of tickets) {
    const target = targets[t.priority];
    const created = new Date(t.createdAt).getTime();
    if (t.firstRespondedAt !== null) {
      frTotal += 1;
      if (new Date(t.firstRespondedAt).getTime() <= created + target.firstResponseMins * MIN_MS) frMet += 1;
    }
    if (t.resolvedAt !== null) {
      resTotal += 1;
      if (new Date(t.resolvedAt).getTime() <= created + target.resolutionMins * MIN_MS) resMet += 1;
    }
  }
  return {
    firstResponsePct: frTotal > 0 ? frMet / frTotal : 1,
    resolutionPct: resTotal > 0 ? resMet / resTotal : 1,
    firstResponseSample: frTotal,
    resolutionSample: resTotal,
  };
}
