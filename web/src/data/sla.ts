import type { SlaHours, SlaState, SlaTargets, Ticket, TicketSla } from './types';

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

interface LocalParts { y: number; mo: number; d: number; tod: number; offsetMs: number }

/** Wall-clock components of `instant` in `tz`, plus that zone's UTC offset. */
function localParts(instant: number, tz: string): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return { y: map.year, mo: map.month, d: map.day, tod: hour * 60 + map.minute, offsetMs: asUTC - instant };
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** UTC instant for a local wall-clock date (proxy midnight UTC) + minutes-of-day in `tz`. */
function instantFromLocal(dayUtc: number, minuteOfDay: number, tz: string): number {
  const day = new Date(dayUtc);
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + minuteOfDay * MIN_MS;
  // Correct for the zone offset (two passes cover the common DST cases).
  let instant = wall - localParts(wall, tz).offsetMs;
  instant = wall - localParts(instant, tz).offsetMs;
  return instant;
}

/**
 * The instant `budgetMins` of business time after `startMs`, counting only the
 * configured weekdays and hours. Falls back to raw wall-clock on a bad config
 * or an unknown timezone so a badge is always produced.
 */
function businessDueMs(startMs: number, budgetMins: number, hours: SlaHours): number {
  const startMin = parseHHMM(hours.start);
  const endMin = parseHHMM(hours.end);
  const daySet = new Set(hours.days);
  if (endMin <= startMin || daySet.size === 0) return startMs + budgetMins * MIN_MS;
  try {
    const parts = localParts(startMs, hours.timezone);
    let cursorDay = Date.UTC(parts.y, parts.mo - 1, parts.d);
    let cursorMin = parts.tod;
    let budget = budgetMins;
    for (let guard = 0; guard < 4000; guard++) {
      if (daySet.has(new Date(cursorDay).getUTCDay())) {
        const from = Math.max(cursorMin, startMin);
        const avail = endMin - from;
        if (avail > 0) {
          if (budget <= avail) return instantFromLocal(cursorDay, from + budget, hours.timezone);
          budget -= avail;
        }
      }
      cursorDay += DAY_MS;
      cursorMin = 0;
    }
  } catch {
    // Unknown timezone — fall through to raw wall-clock.
  }
  return startMs + budgetMins * MIN_MS;
}

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
export function computeTicketSla(ticket: Ticket, targets: SlaTargets, now: number, hours?: SlaHours): TicketSla | null {
  if (ticket.bucket !== 'inbox') return null;
  const target = targets[ticket.priority];
  const created = new Date(ticket.createdAt).getTime();
  const frWindow = target.firstResponseMins * MIN_MS;
  const resWindow = target.resolutionMins * MIN_MS;
  const biz = hours?.enabled === true;
  const frDue = biz ? businessDueMs(created, target.firstResponseMins, hours) : created + frWindow;
  const resDue = biz ? businessDueMs(created, target.resolutionMins, hours) : created + resWindow;
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
export function slaAttainment(tickets: Ticket[], targets: SlaTargets, hours?: SlaHours): SlaAttainment {
  const biz = hours?.enabled === true;
  let frMet = 0;
  let frTotal = 0;
  let resMet = 0;
  let resTotal = 0;
  for (const t of tickets) {
    const target = targets[t.priority];
    const created = new Date(t.createdAt).getTime();
    if (t.firstRespondedAt !== null) {
      frTotal += 1;
      const due = biz ? businessDueMs(created, target.firstResponseMins, hours) : created + target.firstResponseMins * MIN_MS;
      if (new Date(t.firstRespondedAt).getTime() <= due) frMet += 1;
    }
    if (t.resolvedAt !== null) {
      resTotal += 1;
      const due = biz ? businessDueMs(created, target.resolutionMins, hours) : created + target.resolutionMins * MIN_MS;
      if (new Date(t.resolvedAt).getTime() <= due) resMet += 1;
    }
  }
  return {
    firstResponsePct: frTotal > 0 ? frMet / frTotal : 1,
    resolutionPct: resTotal > 0 ? resMet / resTotal : 1,
    firstResponseSample: frTotal,
    resolutionSample: resTotal,
  };
}
