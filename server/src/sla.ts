import type { SlaHours, SlaTargets, Ticket } from './types.js';

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

function instantFromLocal(dayUtc: number, minuteOfDay: number, tz: string): number {
  const day = new Date(dayUtc);
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + minuteOfDay * MIN_MS;
  let instant = wall - localParts(wall, tz).offsetMs;
  instant = wall - localParts(instant, tz).offsetMs;
  return instant;
}

/**
 * The instant `budgetMins` of business time after `startMs`, counting only the
 * configured weekdays and hours. Mirrors web/src/data/sla.ts so the portal's
 * "expected reply by" matches the agent app's SLA clock exactly.
 */
export function businessDueMs(startMs: number, budgetMins: number, hours: SlaHours): number {
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

/**
 * When support aims to send the first reply, from the ticket's first-response
 * SLA target. Null once a reply has been sent, the ticket is resolved, or it
 * left the inbox — i.e. only meaningful while the customer is still waiting.
 */
export function expectedFirstReplyAt(ticket: Ticket, targets: SlaTargets, hours: SlaHours): string | null {
  if (ticket.bucket !== 'inbox') return null;
  if (ticket.firstRespondedAt !== null) return null;
  if (ticket.status === 'solved' || ticket.status === 'closed') return null;
  const created = new Date(ticket.createdAt).getTime();
  const budget = targets[ticket.priority].firstResponseMins;
  const due = hours.enabled ? businessDueMs(created, budget, hours) : created + budget * MIN_MS;
  return new Date(due).toISOString();
}
